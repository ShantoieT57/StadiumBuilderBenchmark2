using System.Buffers;
using System.Globalization;
using System.Text;
using BenchmarkApp2.Data;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Writes transactions as CSV records that open cleanly in a spreadsheet (EX-03, EX-06): RFC 4180
/// quoting, CR LF after every record, amounts with two decimals and a dot, spreadsheet-friendly
/// dates, and text that could run as a formula made harmless.
/// </summary>
public static class TransactionCsv
{
    public const string ContentType = "text/csv; charset=utf-8";

    /// <summary>UTF-8; the byte-order mark is written separately, before the header.</summary>
    public static readonly Encoding Encoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);

    /// <summary>The UTF-8 byte-order mark, so a spreadsheet reads the file as UTF-8.</summary>
    public static ReadOnlySpan<byte> ByteOrderMark => [0xEF, 0xBB, 0xBF];

    // Static fields are initialised in the order they are declared, so these come before HeaderRecord.

    /// <summary>The characters that make a spreadsheet read a cell as a formula (OWASP CSV injection).</summary>
    private static readonly SearchValues<char> FormulaStarts = SearchValues.Create("=+-@\t\r");

    /// <summary>The characters that make a field need quoting (RFC 4180).</summary>
    private static readonly SearchValues<char> QuotedCharacters = SearchValues.Create(",\"\r\n");

    /// <summary>The list's columns (TL-01) plus the review details (EX-03), in order.</summary>
    public static readonly string HeaderRecord = Record(
        "Reference",
        "Transaction Date",
        "Account Number",
        "Description",
        "Amount",
        "Currency",
        "Type",
        "Status",
        "File",
        "Rejection Reason",
        "Last Changed By",
        "Last Changed On");

    private const string LineEnding = "\r\n";

    /// <summary>The transaction date exactly as in the file, with the fraction of a second only when there is one.</summary>
    private const string TransactionDateFormat = "yyyy-MM-dd HH:mm:ss.FFFFFFF";

    /// <summary>When a transaction was last changed, to the second.</summary>
    private const string LastChangedOnFormat = "yyyy-MM-dd HH:mm:ss";

    private const string FormulaGuard = "'";

    /// <summary>One transaction as a record, with Last Changed On in <paramref name="timeZone"/>.</summary>
    public static string ToRecord(TransactionDetailsRow row, TimeZoneInfo timeZone) => Record(
        Text(row.Reference),
        row.TransactionDate.ToString(TransactionDateFormat, CultureInfo.InvariantCulture),
        Text(row.AccountNumber),
        Text(row.Description),
        row.Amount.ToString("F2", CultureInfo.InvariantCulture),
        Text(row.Currency),
        row.TransactionType,
        row.Status,
        Text(row.FileName),
        Text(row.RejectionReason ?? string.Empty),
        Text(row.LastChangedBy),
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(row.LastChangedAt, DateTimeKind.Utc), timeZone)
            .ToString(LastChangedOnFormat, CultureInfo.InvariantCulture));

    private static string Record(params string[] fields) => string.Join(',', fields.Select(Quote)) + LineEnding;

    /// <summary>
    /// Free text that starts like a formula gets a leading apostrophe, so a spreadsheet shows it as
    /// text and never runs it. Only text cells pass through here; amounts, dates and fixed values never do.
    /// </summary>
    private static string Text(string value) =>
        value.Length > 0 && FormulaStarts.Contains(value[0]) ? FormulaGuard + value : value;

    private static string Quote(string field) =>
        field.AsSpan().ContainsAny(QuotedCharacters) ? $"\"{field.Replace("\"", "\"\"")}\"" : field;
}
