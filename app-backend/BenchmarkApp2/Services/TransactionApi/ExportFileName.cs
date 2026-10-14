using System.Globalization;
using System.Text.RegularExpressions;
using BenchmarkApp2.Data;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Names a transaction export after its date and the active filters (EX-04), e.g.
/// <c>transactions_Imported_2026-04-15.csv</c>: <c>transactions</c>, then one part per active
/// filter, always in the order status, file, transaction dates, amounts, search, then the export
/// date, separated by <c>_</c>. The name is safe on every file system. The scheme is documented with
/// the export operation in docs/TransactionApi.yaml.
/// </summary>
public static partial class ExportFileName
{
    private const string Prefix = "transactions";
    private const string Separator = "_";
    private const string Extension = ".csv";
    private const string DateFormat = "yyyy-MM-dd";
    private const string TimeFormat = "yyyy-MM-dd'T'HHmm";
    private const string TimeWithSecondsFormat = "yyyy-MM-dd'T'HHmmss";
    private const string AmountFormat = "0.############################";

    /// <summary>The most characters a file name or search text adds, after it has been made safe.</summary>
    private const int MaxTextLength = 40;

    /// <param name="fileName">The name of the filtered file; used only when the filter has a file.</param>
    public static string Create(TransactionFilter filter, string fileName, DateOnly exportDate)
    {
        var parts = new List<string> { Prefix };
        if (filter.Status is not null)
        {
            parts.Add(filter.Status);
        }
        if (filter.FileId is not null)
        {
            parts.Add(Labelled("file", WithoutExtension(fileName)));
        }
        if (Range(FormatStart(filter.DateFrom), FormatEnd(filter.DateTo), bothEndsPrefix: "from-") is { } dates)
        {
            parts.Add(dates);
        }
        if (Range(FormatAmount(filter.MinAmount), FormatAmount(filter.MaxAmount), bothEndsPrefix: string.Empty) is { } amounts)
        {
            parts.Add($"amount-{amounts}");
        }
        if (filter.Search is not null)
        {
            parts.Add(Labelled("search", filter.Search));
        }
        parts.Add(exportDate.ToString(DateFormat, CultureInfo.InvariantCulture));
        return string.Join(Separator, parts) + Extension;
    }

    /// <summary>
    /// <c>from-a</c>, <c>to-b</c>, or both ends as <c>a-to-b</c> after <paramref name="bothEndsPrefix"/>;
    /// null when neither end is given.
    /// </summary>
    private static string? Range(string? from, string? to, string bothEndsPrefix) => (from, to) switch
    {
        (not null, not null) => $"{bothEndsPrefix}{from}-to-{to}",
        (not null, null) => $"from-{from}",
        (null, not null) => $"to-{to}",
        _ => null,
    };

    /// <summary>A start that is the start of a day is written as the date alone.</summary>
    private static string? FormatStart(DateTime? start) =>
        start is { } value ? (value.TimeOfDay == TimeSpan.Zero ? FormatDate(value) : FormatTime(value)) : null;

    /// <summary>An end that is the last microsecond of a day, as a date alone is read, is written as the date alone.</summary>
    private static string? FormatEnd(DateTime? end) =>
        end is { } value ? (value.AddTicks(TimeSpan.TicksPerMicrosecond).TimeOfDay == TimeSpan.Zero ? FormatDate(value) : FormatTime(value)) : null;

    private static string FormatDate(DateTime value) => value.ToString(DateFormat, CultureInfo.InvariantCulture);

    private static string FormatTime(DateTime value) =>
        value.ToString(value.Second == 0 ? TimeFormat : TimeWithSecondsFormat, CultureInfo.InvariantCulture);

    private static string? FormatAmount(decimal? amount) => amount?.ToString(AmountFormat, CultureInfo.InvariantCulture);

    private static string WithoutExtension(string fileName) =>
        fileName.EndsWith(Extension, StringComparison.OrdinalIgnoreCase) ? fileName[..^Extension.Length] : fileName;

    /// <summary>The label and the safe text, or the label alone when nothing safe is left of the text.</summary>
    private static string Labelled(string label, string text) => Safe(text) is { Length: > 0 } safe ? $"{label}-{safe}" : label;

    /// <summary>
    /// Replaces each run of characters other than letters, digits, <c>-</c> and <c>.</c> with one
    /// <c>-</c>, removes <c>-</c> and <c>.</c> from both ends and keeps at most 40 characters.
    /// </summary>
    private static string Safe(string text)
    {
        var safe = UnsafeCharacters().Replace(text, "-").Trim('-', '.');
        return safe.Length > MaxTextLength ? safe[..MaxTextLength].TrimEnd('-', '.') : safe;
    }

    [GeneratedRegex(@"[^\p{L}\p{M}\p{Nd}.-]+")]
    private static partial Regex UnsafeCharacters();
}
