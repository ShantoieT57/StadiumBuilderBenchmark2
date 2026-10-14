using BenchmarkApp2.Data;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// The query of the transactions list (TL-01..TL-03, SF-01, SF-02): the paging, checked here, and
/// the filter and sort, checked by <see cref="TransactionCriteria"/>.
/// </summary>
public sealed record TransactionListQuery(int Page, int PageSize, TransactionFilter Filter, TransactionSort Sort)
{
    public long Offset => Paging.Offset(Page, PageSize);

    /// <summary>
    /// Applies the defaults and adds an error to <paramref name="errors"/> for each invalid value.
    /// Returns null when any value is invalid.
    /// </summary>
    public static TransactionListQuery? Create(
        int? page,
        int? pageSize,
        TransactionSortColumn? sortBy,
        SortDirection? sortDirection,
        TransactionStatus? status,
        Guid? fileId,
        string? dateFrom,
        string? dateTo,
        decimal? minAmount,
        decimal? maxAmount,
        string? search,
        ModelStateDictionary errors)
    {
        var query = new TransactionListQuery(
            Page: page ?? Paging.DefaultPage,
            PageSize: pageSize ?? Paging.DefaultPageSize,
            Filter: TransactionCriteria.CreateFilter(status, fileId, dateFrom, dateTo, minAmount, maxAmount, search, errors),
            Sort: TransactionCriteria.CreateSort(sortBy, sortDirection));

        Paging.Validate(query.Page, query.PageSize, errors);
        return errors.IsValid ? query : null;
    }

    public TransactionPage ToTransactionPage(TransactionListPage page) => new()
    {
        Items = page.Rows.Select(TransactionMapper.ToListItem).ToList(),
        Page = Page,
        PageSize = PageSize,
        TotalCount = page.TotalCount,
        TotalPages = Paging.TotalPages(page.TotalCount, PageSize),
        HasAnyTransactions = page.HasAnyTransactions,
    };
}
