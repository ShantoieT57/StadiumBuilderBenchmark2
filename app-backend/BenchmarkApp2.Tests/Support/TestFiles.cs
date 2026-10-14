using System.Net.Http.Headers;
using System.Text;
using Reqnroll;

namespace BenchmarkApp2.Tests.Support;

/// <summary>Builds the files and upload requests the scenarios send.</summary>
public static class TestFiles
{
    private const string SampleFilesFolder = "TestFiles";

    public static byte[] ReadSampleFile(string fileName) =>
        File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, SampleFilesFolder, fileName));

    /// <summary>A .csv file with the table's header as its header row and one row per table row.</summary>
    public static byte[] ToCsv(DataTable table)
    {
        var builder = new StringBuilder();
        builder.Append(string.Join(',', table.Header.Select(Quote))).Append('\n');
        foreach (var row in table.Rows)
        {
            builder.Append(string.Join(',', row.Values.Select(Quote))).Append('\n');
        }
        return Encoding.UTF8.GetBytes(builder.ToString());
    }

    /// <summary>A multipart upload request with the file and, when given, the kind of file.</summary>
    public static MultipartFormDataContent CreateUploadForm(byte[] content, string fileName, string? kind)
    {
        var form = new MultipartFormDataContent { CreateFilePart(content, fileName) };
        if (kind is not null)
        {
            form.Add(new StringContent(kind), "kind");
        }
        return form;
    }

    /// <summary>
    /// A multipart file part in the given form field. The file name is always sent, quoted, so an
    /// empty name is sent as <c>filename=""</c>.
    /// </summary>
    public static ByteArrayContent CreateFilePart(byte[] content, string fileName, string fieldName = "file")
    {
        var fileContent = new ByteArrayContent(content);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("text/csv");
        fileContent.Headers.ContentDisposition = new ContentDispositionHeaderValue("form-data")
        {
            Name = $"\"{fieldName}\"",
            FileName = $"\"{fileName}\"",
        };
        return fileContent;
    }

    /// <summary>A .csv file of exactly the given length: a header row padded with transaction rows.</summary>
    public static byte[] CreateCsvContent(int length)
    {
        var builder = new StringBuilder("Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency\n");
        while (builder.Length < length)
        {
            builder.Append("TXN-1,2026/04/15 08:12,1001-2034-5567,Test,1,C,ZAR\n");
        }
        return Encoding.ASCII.GetBytes(builder.ToString(0, length));
    }

    private static string Quote(string value) =>
        value.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? $"\"{value.Replace("\"", "\"\"")}\"" : value;
}
