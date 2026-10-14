namespace BenchmarkApp2.Tests.Support;

/// <summary>Reads values written in scenario tables.</summary>
public static class TableText
{
    /// <summary>
    /// Table cells lose their surrounding spaces, so a value that must keep them is written between
    /// single quotes; this returns the value between the quotes.
    /// </summary>
    public static string Unquote(string value) =>
        value.Length >= 2 && value.StartsWith('\'') && value.EndsWith('\'') ? value[1..^1] : value;
}
