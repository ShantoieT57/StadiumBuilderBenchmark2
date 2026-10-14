using Dapper;
using Npgsql;

namespace BenchmarkApp2.Data;

/// <summary>The values stored in <c>transactions.status</c>.</summary>
public static class TransactionStatusValue
{
    public const string Imported = "Imported";
    public const string Approved = "Approved";
    public const string Rejected = "Rejected";
}

/// <summary>The number of rows in each status; a status with no rows is missing.</summary>
public sealed record DashboardCounts(
    IReadOnlyDictionary<string, int> FilesByStatus,
    IReadOnlyDictionary<string, int> TransactionsByStatus);

public enum FileListSortColumn
{
    FileName,
    LastProcessedAt,
    RowCount,
    Status,
    ImportedCount,
}

public enum FileListVisibility
{
    Active,
    Cancelled,
    Both,
}

/// <summary>Which files to list and in what order. Every filter that is null is not applied.</summary>
public sealed record FileListCriteria(
    string? Status,
    string? FileNameContains,
    DateTimeOffset? ProcessedFrom,
    DateTimeOffset? ProcessedTo,
    FileListVisibility Visibility,
    FileListSortColumn SortBy,
    bool Descending,
    long Offset,
    int Limit);

/// <summary>A file as shown in the dashboard's file list.</summary>
public sealed record FileListRow(
    Guid Id,
    string FileName,
    string Status,
    string? FailureKind,
    string? FailureReason,
    DateTime? LastProcessedAt,
    int? RowCount,
    int ImportedCount,
    bool IsCancelled);

/// <summary>One page of listed files and the number of files that match over every page.</summary>
public sealed record FileListPage(IReadOnlyList<FileListRow> Rows, int TotalCount);

/// <summary>
/// Database access for the dashboard. Only fixed SQL fragments chosen in code are ever put into a
/// statement; every value supplied by a caller is passed as a parameter.
/// </summary>
public sealed class DashboardRepository(NpgsqlDataSource dataSource)
{
    /// <summary>Counts files and transactions by status, over the files that are not cancelled (DB-01).</summary>
    public async Task<DashboardCounts> GetCountsAsync(CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT status AS Status, count(*)::int AS Count
            FROM files
            WHERE cancelled_at IS NULL
            GROUP BY status;

            SELECT t.status AS Status, count(*)::int AS Count
            FROM transactions t
            JOIN files f ON f.id = t.file_id
            WHERE f.cancelled_at IS NULL
            GROUP BY t.status;
            """;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var results = await connection.QueryMultipleAsync(new CommandDefinition(sql, cancellationToken: cancellationToken));
        var files = (await results.ReadAsync<StatusCount>()).ToDictionary(count => count.Status, count => count.Count);
        var transactions = (await results.ReadAsync<StatusCount>()).ToDictionary(count => count.Status, count => count.Count);
        return new DashboardCounts(files, transactions);
    }

    private sealed record StatusCount(string Status, int Count);

    /// <summary>
    /// Lists one page of files (DB-02..DB-06). Files with the same sorted value are ordered by the
    /// order they were received, in the same direction, so paging is deterministic. Null values sort
    /// as the highest values (PostgreSQL's default), so files never processed come first by default.
    /// </summary>
    public async Task<FileListPage> ListFilesAsync(FileListCriteria criteria, CancellationToken cancellationToken)
    {
        var where = BuildWhereClause(criteria);
        var direction = criteria.Descending ? "DESC" : "ASC";
        var sql = $"""
            SELECT f.id, f.file_name AS FileName, f.status, f.failure_kind AS FailureKind,
                   f.failure_reason AS FailureReason, f.last_processed_at AS LastProcessedAt,
                   f.row_count AS RowCount, imported.count AS ImportedCount,
                   f.cancelled_at IS NOT NULL AS IsCancelled
            FROM files f
            CROSS JOIN LATERAL (
                SELECT count(*)::int AS count
                FROM transactions t
                WHERE t.file_id = f.id AND t.status = '{TransactionStatusValue.Imported}') imported
            {where}
            ORDER BY {SortExpression(criteria.SortBy)} {direction}, f.received_order {direction}
            LIMIT @Limit OFFSET @Offset;

            SELECT count(*)::int FROM files f {where};
            """;
        var parameters = new
        {
            criteria.Status,
            criteria.FileNameContains,
            ProcessedFrom = criteria.ProcessedFrom?.ToUniversalTime(),
            ProcessedTo = criteria.ProcessedTo?.ToUniversalTime(),
            criteria.Limit,
            criteria.Offset,
        };

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var results = await connection.QueryMultipleAsync(new CommandDefinition(sql, parameters, cancellationToken: cancellationToken));
        var rows = (await results.ReadAsync<FileListRow>()).ToList();
        var totalCount = await results.ReadSingleAsync<int>();
        return new FileListPage(rows, totalCount);
    }

    private static string BuildWhereClause(FileListCriteria criteria)
    {
        var conditions = new List<string>();
        if (criteria.Status is not null)
        {
            conditions.Add("f.status = @Status");
        }
        if (!string.IsNullOrEmpty(criteria.FileNameContains))
        {
            // strpos matches the text literally, so % and _ are never treated as wildcards.
            conditions.Add("strpos(lower(f.file_name), lower(@FileNameContains)) > 0");
        }
        if (criteria.ProcessedFrom is not null)
        {
            conditions.Add("f.last_processed_at >= @ProcessedFrom");
        }
        if (criteria.ProcessedTo is not null)
        {
            conditions.Add("f.last_processed_at <= @ProcessedTo");
        }
        switch (criteria.Visibility)
        {
            case FileListVisibility.Active:
                conditions.Add("f.cancelled_at IS NULL");
                break;
            case FileListVisibility.Cancelled:
                conditions.Add("f.cancelled_at IS NOT NULL");
                break;
        }
        return conditions.Count == 0 ? string.Empty : "WHERE " + string.Join(" AND ", conditions);
    }

    private static string SortExpression(FileListSortColumn column) => column switch
    {
        FileListSortColumn.FileName => "lower(f.file_name)",
        FileListSortColumn.LastProcessedAt => "f.last_processed_at",
        FileListSortColumn.RowCount => "f.row_count",
        FileListSortColumn.Status => $"""
            CASE f.status
                WHEN '{FileStatusValue.Uploaded}' THEN 0
                WHEN '{FileStatusValue.Processing}' THEN 1
                WHEN '{FileStatusValue.Completed}' THEN 2
                ELSE 3
            END
            """,
        FileListSortColumn.ImportedCount => "imported.count",
        _ => throw new ArgumentOutOfRangeException(nameof(column), column, null),
    };
}
