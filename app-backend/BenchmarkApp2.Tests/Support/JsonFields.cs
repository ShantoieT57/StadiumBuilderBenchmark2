using System.Globalization;
using System.Text.Json;

namespace BenchmarkApp2.Tests.Support;

/// <summary>Reads fields of a JSON response by path and compares them with values written in a scenario.</summary>
public static class JsonFields
{
    /// <summary>The field at a dot-separated path of camelCase property names, e.g. <c>transactions.imported</c>.</summary>
    public static JsonElement Get(JsonElement root, string path)
    {
        var element = root;
        foreach (var name in path.Split('.'))
        {
            if (!element.TryGetProperty(name, out element))
            {
                Assert.Fail($"The response has no field \"{path}\".");
            }
        }
        return element;
    }

    /// <summary>
    /// Asserts that a field has the value written in the scenario. An empty value means null. A field
    /// whose name ends in "At" is a point in time and is compared as one, whatever its offset.
    /// </summary>
    public static void AssertValue(string field, string expected, JsonElement actual)
    {
        if (expected.Length == 0)
        {
            Assert.True(actual.ValueKind == JsonValueKind.Null, $"Expected \"{field}\" to be null, but it was {actual.GetRawText()}.");
            return;
        }

        if (field.EndsWith("At", StringComparison.Ordinal))
        {
            Assert.True(actual.ValueKind == JsonValueKind.String, $"Expected \"{field}\" to be a date and time, but it was {actual.GetRawText()}.");
            Assert.Equal(FileSeeder.ParseDateTime(expected), actual.GetDateTimeOffset());
            return;
        }

        var text = actual.ValueKind switch
        {
            JsonValueKind.String => actual.GetString(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Number => actual.GetDecimal().ToString(CultureInfo.InvariantCulture),
            _ => actual.GetRawText(),
        };
        Assert.True(expected == text, $"Expected \"{field}\" to be \"{expected}\", but it was {actual.GetRawText()}.");
    }
}
