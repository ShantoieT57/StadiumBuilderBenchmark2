using Dapper;
using Npgsql;

namespace BenchmarkApp2.Data;

/// <summary>How a request to cancel a file turned out.</summary>
public enum CancellationOutcome
{
    Cancelled,

    /// <summary>The file was already cancelled; nothing was changed (FX-06).</summary>
    AlreadyCancelled,

    FileNotFound,

    /// <summary>The file has Approved transactions, so it was not cancelled (FX-02).</summary>
    HasApprovedTransactions,
}

/// <summary>The outcome of cancelling a file, with how many of its transactions are Approved when that refused it.</summary>
public sealed record CancellationResult(CancellationOutcome Outcome, int ApprovedCount = 0);

/// <summary>
/// Database access for cancelling a file (FX-02..FX-06). The whole cancel is one database transaction.
/// </summary>
/// <remarks>
/// <para>
/// The file row is locked first (<c>FOR NO KEY UPDATE</c>), the same lock the file processor and
/// the corrector hold for the whole of their work on a file. A cancel therefore waits for processing,
/// a correction or a re-check already under way and then cancels the file in the state that left it;
/// a correction or re-check that starts later waits for the cancel and then finds the file cancelled.
/// </para>
/// <para>
/// The file's transactions are then locked (<c>FOR UPDATE</c>) before the Approved ones are counted,
/// and are deleted while still locked, so no approval can slip in between the check and the delete:
/// an approval committed first is seen by the check, and one that comes later waits and then finds
/// the transaction gone. Approving and rejecting also lock the file row (<c>FOR SHARE</c>, see
/// <see cref="TransactionReviewRepository"/>) and refuse a cancelled file, so an approval and a
/// cancel of the same file never overlap.
/// </para>
/// </remarks>
public sealed class FileCancellationRepository(NpgsqlDataSource dataSource)
{
    public async Task<CancellationResult> CancelAsync(Guid fileId, Guid cancelledBy, DateTimeOffset now, CancellationToken cancellationToken)
    {
        const string lockFileSql = """
            SELECT cancelled_at IS NOT NULL
            FROM files
            WHERE id = @fileId
            FOR NO KEY UPDATE
            """;
        const string countApprovedSql = $"""
            SELECT count(*) FILTER (WHERE status = '{TransactionStatusValue.Approved}')::int
            FROM (SELECT status FROM transactions WHERE file_id = @fileId FOR UPDATE) AS locked
            """;
        // A file claimed for processing whose processing has not started (no processor holds its
        // lock, or the processor was interrupted) returns to Uploaded, so it never stays Processing.
        const string cancelSql = $"""
            DELETE FROM transactions WHERE file_id = @fileId;

            DELETE FROM file_rows WHERE file_id = @fileId;

            UPDATE file_processing_stages
            SET finished_at = @now
            WHERE file_id = @fileId AND finished_at IS NULL;

            INSERT INTO file_processing_stages (file_id, stage, started_at, finished_at)
            VALUES (@fileId, '{nameof(ProcessingStage.Cancelled)}', @now, @now);

            UPDATE files
            SET cancelled_at = @now,
                cancelled_by = @cancelledBy,
                content = NULL,
                status = CASE WHEN status = '{FileStatusValue.Processing}' THEN '{FileStatusValue.Uploaded}' ELSE status END
            WHERE id = @fileId;
            """;

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        var isCancelled = await connection.QuerySingleOrDefaultAsync<bool?>(
            new CommandDefinition(lockFileSql, new { fileId }, transaction, cancellationToken: cancellationToken));
        if (isCancelled is null)
        {
            return new CancellationResult(CancellationOutcome.FileNotFound);
        }
        if (isCancelled.Value)
        {
            return new CancellationResult(CancellationOutcome.AlreadyCancelled);
        }

        var approvedCount = await connection.ExecuteScalarAsync<int>(
            new CommandDefinition(countApprovedSql, new { fileId }, transaction, cancellationToken: cancellationToken));
        if (approvedCount > 0)
        {
            return new CancellationResult(CancellationOutcome.HasApprovedTransactions, approvedCount);
        }

        await connection.ExecuteAsync(
            new CommandDefinition(cancelSql, new { fileId, cancelledBy, now }, transaction, cancellationToken: cancellationToken));
        await transaction.CommitAsync(cancellationToken);
        return new CancellationResult(CancellationOutcome.Cancelled);
    }
}
