using System.Text;

namespace BenchmarkApp2.Services.FileProcessor;

/// <summary>
/// Splits comma-separated text into records of fields (RFC 4180). A field in double quotes may
/// contain commas, line breaks and doubled quotes (<c>""</c> for one quote). Records end at CRLF,
/// LF or CR. Blank lines are not records. Malformed quoting is read leniently rather than refused:
/// a quote inside an unquoted field is kept as a character, text after a closing quote is added to
/// the field, and a quote that is never closed runs to the end of the text.
/// </summary>
public static class CsvParser
{
    private const char Separator = ',';
    private const char Quote = '"';

    public static List<string[]> Parse(string text)
    {
        var records = new List<string[]>();
        var fields = new List<string>();
        var field = new StringBuilder();
        var inQuotes = false;
        var recordHasQuotedField = false;

        void EndField()
        {
            fields.Add(field.ToString());
            field.Clear();
        }

        void EndRecord()
        {
            EndField();
            var isBlankLine = fields.Count == 1 && !recordHasQuotedField && string.IsNullOrWhiteSpace(fields[0]);
            if (!isBlankLine)
            {
                records.Add([.. fields]);
            }
            fields.Clear();
            recordHasQuotedField = false;
        }

        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (inQuotes)
            {
                if (c != Quote)
                {
                    field.Append(c);
                }
                else if (i + 1 < text.Length && text[i + 1] == Quote)
                {
                    field.Append(Quote);
                    i++;
                }
                else
                {
                    inQuotes = false;
                }
            }
            else if (c == Quote && field.Length == 0)
            {
                inQuotes = true;
                recordHasQuotedField = true;
            }
            else if (c == Separator)
            {
                EndField();
            }
            else if (c is '\r' or '\n')
            {
                if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n')
                {
                    i++;
                }
                EndRecord();
            }
            else
            {
                field.Append(c);
            }
        }

        if (field.Length > 0 || fields.Count > 0 || recordHasQuotedField)
        {
            EndRecord();
        }
        return records;
    }
}
