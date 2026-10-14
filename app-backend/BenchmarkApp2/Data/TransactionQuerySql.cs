using Dapper;

namespace BenchmarkApp2.Data;

public enum TransactionListSortColumn
{
    TransactionDate,
    Reference,
    AccountNumber,
    Description,
    Amount,
    Currency,
    TransactionType,
    Status,
    FileName,
}

/// <summary>
/// Which transactions to select (SF-01, SF-02). Every filter that is null is not applied. Dates are
/// local dates and times with no time zone, like <c>transactions.transaction_date</c>; both ends of
/// each range are inclusive.
/// </summary>
public sealed record TransactionFilter(
    string? Status = null,
    Guid? FileId = null,
    DateTime? DateFrom = null,
    DateTime? DateTo = null,
    decimal? MinAmount = null,
    decimal? MaxAmount = null,
    string? Search = null)
{
    /// <summary>True when no filter is applied, so every transaction is selected (EX-02).</summary>
    public bool IsEmpty => this == new TransactionFilter();
}

/// <summary>The column to sort transactions on and its direction (TL-02).</summary>
public sealed record TransactionSort(TransactionListSortColumn Column, bool Descending);

/// <summary>
/// Builds the parts of a statement selecting transactions by a <see cref="TransactionFilter"/> in
/// the order of a <see cref="TransactionSort"/>. Shared by every query that must apply the same
/// filters and sort, such as the transactions list and the export (EX-01). Only fixed SQL fragments
/// chosen in code are put into a statement; every value supplied by a caller is a parameter.
/// The transactions are aliased <c>t</c> and their files <c>f</c>.
/// </summary>
public static class TransactionQuerySql
{
    /// <summary>
    /// The transactions of files that are not cancelled. Cancelling a file removes its transactions,
    /// but the join makes sure a cancelled file's transactions can never be selected anyway.
    /// </summary>
    public const string From = "FROM transactions t JOIN files f ON f.id = t.file_id AND f.cancelled_at IS NULL";

    /// <summary>The WHERE clause for the filter, or an empty string when no filter is applied.</summary>
    public static string Where(TransactionFilter filter)
    {
        var conditions = new List<string>();
        if (filter.Status is not null)
        {
            conditions.Add("t.status = @Status");
        }
        if (filter.FileId is not null)
        {
            conditions.Add("t.file_id = @FileId");
        }
        if (filter.DateFrom is not null)
        {
            conditions.Add("t.transaction_date >= @DateFrom");
        }
        if (filter.DateTo is not null)
        {
            conditions.Add("t.transaction_date <= @DateTo");
        }
        if (filter.MinAmount is not null)
        {
            conditions.Add("t.amount >= @MinAmount");
        }
        if (filter.MaxAmount is not null)
        {
            conditions.Add("t.amount <= @MaxAmount");
        }
        if (!string.IsNullOrEmpty(filter.Search))
        {
            // strpos matches the text literally, so % and _ are never treated as wildcards.
            conditions.Add("(strpos(lower(t.reference), lower(@Search)) > 0 OR strpos(lower(t.account_number), lower(@Search)) > 0)");
        }
        return conditions.Count == 0 ? string.Empty : "WHERE " + string.Join(" AND ", conditions);
    }

    /// <summary>
    /// The ORDER BY clause for the sort. Ties are broken by the reference ignoring case, which is
    /// unique across the app (FP-05), in the same direction, so the order is total and paging is
    /// stable.
    /// </summary>
    public static string OrderBy(TransactionSort sort)
    {
        var direction = sort.Descending ? "DESC" : "ASC";
        return $"ORDER BY {SortExpression(sort.Column)} {direction}, lower(t.reference) {direction}, t.id {direction}";
    }

    /// <summary>The parameters referenced by <see cref="Where"/>; callers add their own, e.g. for paging.</summary>
    public static DynamicParameters Parameters(TransactionFilter filter)
    {
        var parameters = new DynamicParameters();
        AddIfPresent(parameters, "Status", filter.Status);
        AddIfPresent(parameters, "FileId", filter.FileId);
        AddIfPresent(parameters, "DateFrom", filter.DateFrom);
        AddIfPresent(parameters, "DateTo", filter.DateTo);
        AddIfPresent(parameters, "MinAmount", filter.MinAmount);
        AddIfPresent(parameters, "MaxAmount", filter.MaxAmount);
        AddIfPresent(parameters, "Search", filter.Search);
        return parameters;
    }

    private static void AddIfPresent(DynamicParameters parameters, string name, object? value)
    {
        if (value is not null)
        {
            parameters.Add(name, value);
        }
    }

    private static string SortExpression(TransactionListSortColumn column) => column switch
    {
        TransactionListSortColumn.TransactionDate => "t.transaction_date",
        TransactionListSortColumn.Reference => "lower(t.reference)",
        TransactionListSortColumn.AccountNumber => "lower(t.account_number)",
        TransactionListSortColumn.Description => "lower(t.description)",
        TransactionListSortColumn.Amount => "t.amount",
        TransactionListSortColumn.Currency => "lower(t.currency)",
        TransactionListSortColumn.TransactionType => "t.transaction_type",
        TransactionListSortColumn.Status => $"""
            CASE t.status
                WHEN '{TransactionStatusValue.Imported}' THEN 0
                WHEN '{TransactionStatusValue.Approved}' THEN 1
                ELSE 2
            END
            """,
        TransactionListSortColumn.FileName => "lower(f.file_name)",
        _ => throw new ArgumentOutOfRangeException(nameof(column), column, null),
    };
}
