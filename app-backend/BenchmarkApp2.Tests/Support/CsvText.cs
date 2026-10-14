using System.Text;

namespace BenchmarkApp2.Tests.Support;

/// <summary>
/// Reads CSV text strictly as RFC 4180 describes it, as a spreadsheet would: records end with CR LF
/// (the last one too), a field holding a comma, a double quote or a line break is enclosed in double
/// quotes, and a double quote inside such a field is doubled. Anything else, such as a line break
/// outside quotes that is not CR LF or a quote inside an unquoted field, is refused.
/// </summary>
public static class CsvText
{
    public static List<List<string>> Parse(string text)
    {
        var records = new List<List<string>>();
        var record = new List<string>();
        var field = new StringBuilder();
        var position = 0;
        while (position < text.Length)
        {
            if (text[position] == '"')
            {
                position = ReadQuotedField(text, position + 1, field);
            }
            else
            {
                while (position < text.Length && text[position] is not (',' or '\r' or '\n'))
                {
                    if (text[position] == '"')
                    {
                        throw new FormatException($"A double quote at {position} is inside a field that is not quoted.");
                    }
                    field.Append(text[position++]);
                }
            }

            record.Add(field.ToString());
            field.Clear();
            if (position < text.Length && text[position] == ',')
            {
                position++;
                continue;
            }
            if (!text.AsSpan(position).StartsWith("\r\n"))
            {
                throw new FormatException($"The record ending at {position} does not end with CR LF.");
            }
            position += 2;
            records.Add(record);
            record = [];
        }
        return records;
    }

    /// <summary>Reads a quoted field starting after its opening quote and returns the position after its closing quote.</summary>
    private static int ReadQuotedField(string text, int position, StringBuilder field)
    {
        while (true)
        {
            if (position >= text.Length)
            {
                throw new FormatException("A quoted field is never closed.");
            }
            if (text[position] != '"')
            {
                field.Append(text[position++]);
            }
            else if (position + 1 < text.Length && text[position + 1] == '"')
            {
                field.Append('"');
                position += 2;
            }
            else
            {
                return position + 1;
            }
        }
    }
}
