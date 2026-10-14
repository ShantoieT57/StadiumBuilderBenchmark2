using System.Text.RegularExpressions;

namespace BenchmarkApp2.Tests.Support;

/// <summary>Turns a query written in a scenario into the query string that is sent.</summary>
public static partial class QueryText
{
    /// <summary>
    /// Appends the query to the path after replacing each "{file name}" with the id of that seeded
    /// file; an empty query sends the path alone.
    /// </summary>
    public static string ToPath(string path, string query, FileSeeder files)
    {
        var resolved = FileNamePlaceholder().Replace(query, match => files.GetFileId(match.Groups[1].Value).ToString()).TrimStart('&');
        return resolved.Length == 0 ? path : $"{path}?{resolved}";
    }

    [GeneratedRegex(@"\{([^}]+)\}")]
    private static partial Regex FileNamePlaceholder();
}
