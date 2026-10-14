using System.Globalization;
using System.Text.RegularExpressions;
using BenchmarkApp2.Data;

namespace BenchmarkApp2.Services.FileProcessor;

/// <summary>A row with its values converted to their types; a value that cannot be converted is null.</summary>
public sealed record ConvertedRow(FileRowValues Values, string? TransactionType, DateTime? TransactionDate, decimal? Amount);

/// <summary>A converted row with every row rule it breaks. An ignored row (empty reference) is never checked.</summary>
public sealed record CheckedRow(ConvertedRow Row, IReadOnlyList<string> Reasons)
{
    public bool IsIgnored => !Row.Values.HasReference;

    public bool IsInvalid => Reasons.Count > 0;

    public FileRowRecord ToRecord() => new(Row.Values, Reasons);

    /// <summary>The transaction a valid row is loaded as, with surrounding spaces removed from its values.</summary>
    public NewTransactionRecord ToTransaction() => new(
        Row.Values.Reference.Trim(),
        Row.TransactionDate!.Value,
        Row.Values.AccountNumber.Trim(),
        Row.Values.Description.Trim(),
        Row.Amount!.Value,
        Row.TransactionType!,
        Row.Values.Currency.Trim());
}

/// <summary>
/// Stages 4 (Convert types) and 5 (Check rows). Both work only on a row's original values, so a
/// file's kept rows can be checked again after they are corrected.
/// </summary>
public static partial class RowChecker
{
    public const string WrongNumberOfColumns = "Wrong Number Of Columns";
    public const string InvalidTransactionType = "Invalid Transaction Type";
    public const string InvalidTransactionDate = "Invalid Transaction Date";
    public const string InvalidAmount = "Invalid Amount";
    public const string MissingAccountNumber = "Missing Account Number";
    public const string DuplicateReferenceInFile = "Duplicate Reference In File";

    public const string Credit = "Credit";
    public const string Debit = "Debit";

    /// <summary>The amount column (numeric(18,2)) holds amounts below this.</summary>
    private const decimal AmountLimit = 10_000_000_000_000_000m;

    /// <summary>
    /// The date and time forms accepted, all with the year first so day and month are never
    /// confused: the bank's form (2026/04/15 08:12) and ISO 8601 local date-times, with or without
    /// seconds and fractions of a second, and with or without leading zeros. Forms with a time zone
    /// are not accepted, because transaction dates are stored as written, without a time zone.
    /// </summary>
    private static readonly string[] DateFormats =
    [
        "yyyy/M/d H:mm", "yyyy/M/d H:mm:ss", "yyyy/M/d H:mm:ss.FFFFFFF",
        "yyyy-M-d H:mm", "yyyy-M-d H:mm:ss", "yyyy-M-d H:mm:ss.FFFFFFF",
        "yyyy-M-d'T'H:mm", "yyyy-M-d'T'H:mm:ss", "yyyy-M-d'T'H:mm:ss.FFFFFFF",
    ];

    /// <summary>Stage 4: C becomes Credit and D becomes Debit, and dates and amounts are read.</summary>
    public static IReadOnlyList<ConvertedRow> Convert(IReadOnlyList<FileRowValues> rows) =>
        rows.Select(row => new ConvertedRow(
            row,
            ConvertTransactionType(row.TransactionType),
            ConvertTransactionDate(row.TransactionDate),
            ConvertAmount(row.Amount))).ToList();

    /// <summary>
    /// Stage 5: every row with a reference is checked against every row rule (FP-03), and gets every
    /// reason it fails (FP-04). A reference that appears more than once in the file, ignoring upper
    /// and lower case, makes every row with it invalid.
    /// </summary>
    public static IReadOnlyList<CheckedRow> Check(IReadOnlyList<ConvertedRow> rows)
    {
        var repeatedReferences = rows
            .Where(row => row.Values.HasReference)
            .GroupBy(row => NormaliseReference(row.Values.Reference))
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToHashSet();

        return rows.Select(row => new CheckedRow(
            row,
            row.Values.HasReference ? FindReasons(row, repeatedReferences) : [])).ToList();
    }

    private static List<string> FindReasons(ConvertedRow row, HashSet<string> repeatedReferences)
    {
        var reasons = new List<string>();
        if (row.Values.ColumnCount != TransactionFileReader.ColumnCount)
        {
            reasons.Add(WrongNumberOfColumns);
        }
        if (row.TransactionType is null)
        {
            reasons.Add(InvalidTransactionType);
        }
        if (row.TransactionDate is null)
        {
            reasons.Add(InvalidTransactionDate);
        }
        if (row.Amount is null)
        {
            reasons.Add(InvalidAmount);
        }
        if (string.IsNullOrWhiteSpace(row.Values.AccountNumber))
        {
            reasons.Add(MissingAccountNumber);
        }
        if (repeatedReferences.Contains(NormaliseReference(row.Values.Reference)))
        {
            reasons.Add(DuplicateReferenceInFile);
        }
        return reasons;
    }

    /// <summary>Matches the database's <c>lower(reference)</c> uniqueness.</summary>
    private static string NormaliseReference(string reference) => reference.Trim().ToLowerInvariant();

    private static string? ConvertTransactionType(string value) => value.Trim() switch
    {
        "C" => Credit,
        "D" => Debit,
        _ => null,
    };

    private static DateTime? ConvertTransactionDate(string value) =>
        DateTime.TryParseExact(value.Trim(), DateFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? date
            : null;

    /// <summary>Digits with an optional point and one or two decimals: never negative, no thousands separators or exponents.</summary>
    private static decimal? ConvertAmount(string value)
    {
        var trimmed = value.Trim();
        return AmountPattern().IsMatch(trimmed)
               && decimal.TryParse(trimmed, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var amount)
               && amount < AmountLimit
            ? amount
            : null;
    }

    [GeneratedRegex(@"^[0-9]+(\.[0-9]{1,2})?$")]
    private static partial Regex AmountPattern();
}
