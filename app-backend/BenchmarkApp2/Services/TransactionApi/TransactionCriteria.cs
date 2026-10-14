using System.Globalization;
using BenchmarkApp2.Data;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Turns the transaction filter and sort query parameters into repository criteria, checking the
/// values the binder could not refuse by itself (SF-01, SF-02, TL-02). Shared by every endpoint that
/// takes these parameters, so the transactions list and the export (EX-01) select exactly the same
/// transactions in the same order. Sort columns, directions and statuses arrive as enums, so only
/// known values ever get this far.
/// </summary>
public static class TransactionCriteria
{
    private const string DateFromParameter = "dateFrom";
    private const string DateToParameter = "dateTo";
    private const string MinAmountParameter = "minAmount";
    private const string MaxAmountParameter = "maxAmount";

    /// <summary>A date alone, or a local date and time with optional seconds and fraction; never a time zone.</summary>
    private const string DateOnlyFormat = "yyyy-MM-dd";
    private static readonly string[] DateTimeFormats =
        ["yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF"];

    /// <summary>PostgreSQL stores times to the microsecond, which is 10 ticks.</summary>
    private const long TicksPerMicrosecond = 10;

    /// <summary>
    /// Builds the filter and adds an error to <paramref name="errors"/>, under the query parameter's
    /// name, for each invalid value. The returned filter must not be used when there are errors.
    /// </summary>
    public static TransactionFilter CreateFilter(
        TransactionStatus? status,
        Guid? fileId,
        string? dateFrom,
        string? dateTo,
        decimal? minAmount,
        decimal? maxAmount,
        string? search,
        ModelStateDictionary errors)
    {
        var from = ParseDateBound(dateFrom, isEnd: false, DateFromParameter, errors);
        var to = ParseDateBound(dateTo, isEnd: true, DateToParameter, errors);
        if (from > to)
        {
            errors.AddModelError(DateToParameter, "The end of the transaction-date range must not be before its start.");
        }

        if (minAmount < 0)
        {
            errors.AddModelError(MinAmountParameter, "The minimum amount must be 0 or more.");
        }
        if (maxAmount < 0)
        {
            errors.AddModelError(MaxAmountParameter, "The maximum amount must be 0 or more.");
        }
        if (minAmount > maxAmount)
        {
            errors.AddModelError(MaxAmountParameter, "The maximum amount must not be less than the minimum amount.");
        }

        var searchText = search?.Trim();
        return new TransactionFilter(
            Status: status?.ToString(),
            FileId: fileId,
            DateFrom: from,
            DateTo: to,
            MinAmount: minAmount,
            MaxAmount: maxAmount,
            Search: string.IsNullOrEmpty(searchText) ? null : searchText);
    }

    /// <summary>The most recent transaction date comes first by default; every other column starts ascending.</summary>
    public static TransactionSort CreateSort(TransactionSortColumn? sortBy, SortDirection? sortDirection)
    {
        var column = sortBy ?? TransactionSortColumn.TransactionDate;
        var direction = sortDirection ?? (column == TransactionSortColumn.TransactionDate ? SortDirection.Desc : SortDirection.Asc);
        return new TransactionSort(ToListSortColumn(column), direction == SortDirection.Desc);
    }

    /// <summary>
    /// Reads one end of the transaction-date range. A date alone covers the whole day: from its
    /// start, or up to and including its last microsecond. A date and time is used as given, to the
    /// microsecond. Returns null when the value is missing or invalid.
    /// </summary>
    private static DateTime? ParseDateBound(string? value, bool isEnd, string parameter, ModelStateDictionary errors)
    {
        if (string.IsNullOrEmpty(value))
        {
            return null;
        }
        if (DateTime.TryParseExact(value, DateOnlyFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
        {
            return isEnd ? date.AddDays(1).AddTicks(-TicksPerMicrosecond) : date;
        }
        if (DateTime.TryParseExact(value, DateTimeFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dateTime))
        {
            return dateTime.AddTicks(-(dateTime.Ticks % TicksPerMicrosecond));
        }

        errors.AddModelError(parameter, "The value must be a date (yyyy-MM-dd) or a date and time without a time zone (yyyy-MM-ddTHH:mm[:ss[.fffffff]]).");
        return null;
    }

    private static TransactionListSortColumn ToListSortColumn(TransactionSortColumn column) => column switch
    {
        TransactionSortColumn.Reference => TransactionListSortColumn.Reference,
        TransactionSortColumn.AccountNumber => TransactionListSortColumn.AccountNumber,
        TransactionSortColumn.Description => TransactionListSortColumn.Description,
        TransactionSortColumn.Amount => TransactionListSortColumn.Amount,
        TransactionSortColumn.Currency => TransactionListSortColumn.Currency,
        TransactionSortColumn.TransactionType => TransactionListSortColumn.TransactionType,
        TransactionSortColumn.Status => TransactionListSortColumn.Status,
        TransactionSortColumn.FileName => TransactionListSortColumn.FileName,
        _ => TransactionListSortColumn.TransactionDate,
    };
}
