namespace BenchmarkApp2.Tests.Support;

/// <summary>Reads values written in scenario tables and steps.</summary>
public static class TableText
{
    /// <summary>
    /// Table cells lose their surrounding spaces, so a value that must keep them is written between
    /// single quotes; this returns the value between the quotes.
    /// </summary>
    public static string Unquote(string value) =>
        value.Length >= 2 && value.StartsWith('\'') && value.EndsWith('\'') ? value[1..^1] : value;

    /// <summary>
    /// Control characters cannot be written in a scenario, so they are written as [TAB], [CR] and
    /// [LF]; this returns the value with the real characters.
    /// </summary>
    public static string ExpandControlCharacters(string value) =>
        value.Replace("[TAB]", "\t").Replace("[CR]", "\r").Replace("[LF]", "\n");
}
