using System.Text.Json;

namespace BenchmarkApp2.Tests.Support;

/// <summary>Reads the <c>errors</c> of an RFC 7807 validation problem response.</summary>
public static class ValidationErrors
{
    /// <summary>The messages of each key, with the keys exactly as the response gives them.</summary>
    public static IReadOnlyDictionary<string, string[]> Read(string responseBody)
    {
        using var json = JsonDocument.Parse(responseBody);
        return json.RootElement.GetProperty("errors").EnumerateObject().ToDictionary(
            error => error.Name,
            error => error.Value.EnumerateArray().Select(message => message.GetString()!).ToArray(),
            StringComparer.Ordinal);
    }
}
