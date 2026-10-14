using System.Globalization;
using BenchmarkApp2.Data;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>Turns transaction rows into API models.</summary>
public static class TransactionMapper
{
    /// <summary>ISO 8601 without an offset; the fraction of a second appears only when there is one.</summary>
    private const string LocalDateTimeFormat = "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF";

    public static TransactionListItem ToListItem(TransactionListRow row) => new()
    {
        Id = row.Id,
        Reference = row.Reference,
        TransactionDate = FormatTransactionDate(row.TransactionDate),
        AccountNumber = row.AccountNumber,
        Description = row.Description,
        Amount = ToTwoDecimalPlaces(row.Amount),
        Currency = row.Currency,
        TransactionType = Enum.Parse<TransactionType>(row.TransactionType),
        Status = Enum.Parse<TransactionStatus>(row.Status),
        File = ToFile(row.FileId, row.FileName),
    };

    public static TransactionDetails ToDetails(TransactionDetailsRow row) => new()
    {
        Id = row.Id,
        Reference = row.Reference,
        TransactionDate = FormatTransactionDate(row.TransactionDate),
        AccountNumber = row.AccountNumber,
        Description = row.Description,
        Amount = ToTwoDecimalPlaces(row.Amount),
        Currency = row.Currency,
        TransactionType = Enum.Parse<TransactionType>(row.TransactionType),
        Status = Enum.Parse<TransactionStatus>(row.Status),
        File = ToFile(row.FileId, row.FileName),
        CreatedBy = row.CreatedBy,
        CreatedAt = ToUtc(row.CreatedAt),
        LastChangedBy = row.LastChangedBy,
        LastChangedAt = ToUtc(row.LastChangedAt),
        RejectionReason = row.RejectionReason,
    };

    private static TransactionFile ToFile(Guid id, string fileName) => new() { Id = id, FileName = fileName };

    /// <summary>A transaction date is a local date and time with no time zone, so it is sent without an offset.</summary>
    private static string FormatTransactionDate(DateTime value) => value.ToString(LocalDateTimeFormat, CultureInfo.InvariantCulture);

    /// <summary>
    /// Gives the amount exactly two decimal places, so it is written as a JSON number such as
    /// <c>1500.00</c>: adding a zero with two decimal places never lowers the scale.
    /// </summary>
    private static decimal ToTwoDecimalPlaces(decimal amount) => decimal.Round(amount, 2) + 0.00m;

    private static DateTimeOffset ToUtc(DateTime value) => new(DateTime.SpecifyKind(value, DateTimeKind.Utc));
}
