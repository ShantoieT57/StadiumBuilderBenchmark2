using Dapper;
using Npgsql;

namespace BenchmarkApp2.Data;

/// <summary>A transaction as shown in the transactions list, with the file it came from.</summary>
public sealed record TransactionListRow(
    Guid Id,
    string Reference,
    DateTime TransactionDate,
    string AccountNumber,
    string Description,
    decimal Amount,
    string Currency,
    string TransactionType,
    string Status,
    Guid FileId,
    string FileName);

/// <summary>
/// One page of listed transactions, the number that match over every page, and whether any
/// transaction exists at all, ignoring the filters.
/// </summary>
public sealed record TransactionListPage(IReadOnlyList<TransactionListRow> Rows, int TotalCount, bool HasAnyTransactions);

/// <summary>All of a transaction's details (TL-06).</summary>
public sealed record TransactionDetailsRow(
    Guid Id,
    string Reference,
    DateTime TransactionDate,
    string AccountNumber,
    string Description,
    decimal Amount,
    string Currency,
    string TransactionType,
    string Status,
    Guid FileId,
    string FileName,
    string CreatedBy,
    DateTime CreatedAt,
    string LastChangedBy,
    DateTime LastChangedAt,
    string? RejectionReason);

/// <summary>Database access for reading transactions. Only transactions of files that are not cancelled are ever read.</summary>
public sealed class TransactionRepository(NpgsqlDataSource dataSource)
{
    private const string ListColumns = """
        t.id, t.reference, t.transaction_date AS TransactionDate, t.account_number AS AccountNumber,
        t.description, t.amount, t.currency, t.transaction_type AS TransactionType, t.status,
        t.file_id AS FileId, f.file_name AS FileName
        """;

    /// <summary>Lists one page of the transactions that match the filter, in the sort order (TL-01..TL-03, SF-01, SF-02).</summary>
    public async Task<TransactionListPage> ListAsync(
        TransactionFilter filter, TransactionSort sort, long offset, int limit, CancellationToken cancellationToken)
    {
        var where = TransactionQuerySql.Where(filter);
        var sql = $"""
            SELECT {ListColumns}
            {TransactionQuerySql.From}
            {where}
            {TransactionQuerySql.OrderBy(sort)}
            LIMIT @Limit OFFSET @Offset;

            SELECT count(*)::int {TransactionQuerySql.From} {where};

            SELECT EXISTS (SELECT 1 {TransactionQuerySql.From});
            """;
        var parameters = TransactionQuerySql.Parameters(filter);
        parameters.Add("Limit", limit);
        parameters.Add("Offset", offset);

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var results = await connection.QueryMultipleAsync(new CommandDefinition(sql, parameters, cancellationToken: cancellationToken));
        var rows = (await results.ReadAsync<TransactionListRow>()).ToList();
        var totalCount = await results.ReadSingleAsync<int>();
        var hasAnyTransactions = await results.ReadSingleAsync<bool>();
        return new TransactionListPage(rows, totalCount, hasAnyTransactions);
    }

    /// <summary>The transaction's details, or null when no transaction of a file that is not cancelled has the id.</summary>
    public async Task<TransactionDetailsRow?> GetAsync(Guid transactionId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await GetAsync(connection, transaction: null, transactionId, cancellationToken);
    }

    /// <summary>
    /// The transaction's details read on an open connection, within <paramref name="transaction"/>
    /// when given, or null when no transaction of a file that is not cancelled has the id.
    /// </summary>
    public static Task<TransactionDetailsRow?> GetAsync(
        NpgsqlConnection connection, NpgsqlTransaction? transaction, Guid transactionId, CancellationToken cancellationToken)
    {
        const string sql = $"""
            SELECT {ListColumns},
                   t.created_by AS CreatedBy, t.created_at AS CreatedAt,
                   t.last_changed_by AS LastChangedBy, t.last_changed_at AS LastChangedAt,
                   t.rejection_reason AS RejectionReason
            {TransactionQuerySql.From}
            WHERE t.id = @transactionId
            """;
        return connection.QuerySingleOrDefaultAsync<TransactionDetailsRow>(
            new CommandDefinition(sql, new { transactionId }, transaction, cancellationToken: cancellationToken));
    }

    /// <summary>How many transactions are still Imported (TL-07).</summary>
    public async Task<int> CountImportedAsync(CancellationToken cancellationToken)
    {
        const string sql = $"""
            SELECT count(*)::int
            {TransactionQuerySql.From}
            WHERE t.status = '{TransactionStatusValue.Imported}'
            """;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.ExecuteScalarAsync<int>(new CommandDefinition(sql, cancellationToken: cancellationToken));
    }
}
