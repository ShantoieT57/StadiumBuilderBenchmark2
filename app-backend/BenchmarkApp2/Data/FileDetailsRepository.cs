using Dapper;
using Npgsql;

namespace BenchmarkApp2.Data;

/// <summary>A file as shown on its detail screen, with the number of its transactions in each status.</summary>
public sealed record FileDetailsRecord(
    Guid Id,
    string FileName,
    string Kind,
    string Status,
    string? FailureKind,
    string? FailureReason,
    string UploadedBy,
    DateTime UploadedAt,
    DateTime? LastProcessedAt,
    DateTime? CancelledAt,
    string? CancelledBy,
    int? RowCount,
    int? LoadedCount,
    int? SkippedExistingCount,
    int? IgnoredEmptyReferenceCount,
    int ImportedCount,
    int ApprovedCount,
    int RejectedCount,
    bool HasContent);

/// <summary>A stage in a file's processing history; a stage still under way has no finish time.</summary>
public sealed record ProcessingStageRecord(string Stage, DateTime StartedAt, DateTime? FinishedAt);

/// <summary>A file's original content, which is null once it has been discarded.</summary>
public sealed record FileContentRecord(string FileName, byte[]? Content, DateTime? CancelledAt);

/// <summary>What decides whether a file waits for corrections, so its invalid rows can be listed and corrected.</summary>
public sealed record FileCorrectionStateRecord(string Status, string? FailureKind, DateTime? CancelledAt)
{
    /// <summary>A file waits for corrections while it is Failed because of invalid rows and is not cancelled (FS-02, FX-04).</summary>
    public bool IsWaitingForCorrections =>
        Status == FileStatusValue.Failed
        && FailureKind == nameof(FileFailureKind.InvalidRows)
        && CancelledAt is null;
}

/// <summary>An invalid row kept for corrections, with its original column values and every reason it failed.</summary>
public sealed class InvalidRowRecord
{
    public Guid Id { get; init; }
    public int RowNumber { get; init; }
    public string Reference { get; init; } = string.Empty;
    public string TransactionDate { get; init; } = string.Empty;
    public string AccountNumber { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string Amount { get; init; } = string.Empty;
    public string TransactionType { get; init; } = string.Empty;
    public string Currency { get; init; } = string.Empty;

    /// <summary>A class rather than a record, because Dapper reads a <c>text[]</c> column into a property but not into a constructor parameter.</summary>
    public string[] Reasons { get; init; } = [];
}

/// <summary>Database access for reading a single file: its details, history, original content and invalid rows.</summary>
public sealed class FileDetailsRepository(NpgsqlDataSource dataSource)
{
    /// <summary>The file's details, or null when no file has the id.</summary>
    public async Task<FileDetailsRecord?> GetDetailsAsync(Guid fileId, CancellationToken cancellationToken)
    {
        const string sql = $"""
            SELECT f.id, f.file_name AS FileName, f.kind, f.status, f.failure_kind AS FailureKind,
                   f.failure_reason AS FailureReason, u.name AS UploadedBy, f.uploaded_at AS UploadedAt,
                   f.last_processed_at AS LastProcessedAt, f.cancelled_at AS CancelledAt, canceller.name AS CancelledBy,
                   f.row_count AS RowCount,
                   f.loaded_count AS LoadedCount, f.skipped_existing_count AS SkippedExistingCount,
                   f.ignored_empty_reference_count AS IgnoredEmptyReferenceCount,
                   t.imported AS ImportedCount, t.approved AS ApprovedCount, t.rejected AS RejectedCount,
                   f.content IS NOT NULL AS HasContent
            FROM files f
            JOIN users u ON u.id = f.uploaded_by
            LEFT JOIN users canceller ON canceller.id = f.cancelled_by
            CROSS JOIN LATERAL (
                SELECT count(*) FILTER (WHERE status = '{TransactionStatusValue.Imported}')::int AS imported,
                       count(*) FILTER (WHERE status = '{TransactionStatusValue.Approved}')::int AS approved,
                       count(*) FILTER (WHERE status = '{TransactionStatusValue.Rejected}')::int AS rejected
                FROM transactions
                WHERE file_id = f.id) t
            WHERE f.id = @fileId
            """;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<FileDetailsRecord>(new CommandDefinition(sql, new { fileId }, cancellationToken: cancellationToken));
    }

    /// <summary>The file's processing history, in the order the stages ran (FD-04).</summary>
    public async Task<IReadOnlyList<ProcessingStageRecord>> GetProcessingHistoryAsync(Guid fileId, CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT stage, started_at AS StartedAt, finished_at AS FinishedAt
            FROM file_processing_stages
            WHERE file_id = @fileId
            ORDER BY id
            """;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return (await connection.QueryAsync<ProcessingStageRecord>(new CommandDefinition(sql, new { fileId }, cancellationToken: cancellationToken))).ToList();
    }

    /// <summary>The file's name and original content, or null when no file has the id.</summary>
    public async Task<FileContentRecord?> GetContentAsync(Guid fileId, CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT file_name AS FileName, content, cancelled_at AS CancelledAt
            FROM files
            WHERE id = @fileId
            """;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<FileContentRecord>(new CommandDefinition(sql, new { fileId }, cancellationToken: cancellationToken));
    }

    /// <summary>What decides whether the file waits for corrections, or null when no file has the id.</summary>
    public async Task<FileCorrectionStateRecord?> GetCorrectionStateAsync(Guid fileId, CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT status, failure_kind AS FailureKind, cancelled_at AS CancelledAt
            FROM files
            WHERE id = @fileId
            """;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<FileCorrectionStateRecord>(new CommandDefinition(sql, new { fileId }, cancellationToken: cancellationToken));
    }

    /// <summary>The file's invalid rows, in file order (FC-01).</summary>
    public async Task<IReadOnlyList<InvalidRowRecord>> GetInvalidRowsAsync(Guid fileId, CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT id, row_number AS RowNumber, reference, transaction_date AS TransactionDate,
                   account_number AS AccountNumber, description, amount, transaction_type AS TransactionType,
                   currency, reasons
            FROM file_rows
            WHERE file_id = @fileId AND cardinality(reasons) > 0
            ORDER BY row_number
            """;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return (await connection.QueryAsync<InvalidRowRecord>(new CommandDefinition(sql, new { fileId }, cancellationToken: cancellationToken))).ToList();
    }
}
