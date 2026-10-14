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
        var fileContent = new ByteArrayContent(content);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("text/csv");
        fileContent.Headers.ContentDisposition = new ContentDispositionHeaderValue("form-data")
        {
            Name = "\"file\"",
            FileName = $"\"{fileName}\"",
        };

        var form = new MultipartFormDataContent { fileContent };
        if (kind is not null)
        {
            form.Add(new StringContent(kind), "kind");
        }
        return form;
    }

    private static string Quote(string value) =>
        value.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? $"\"{value.Replace("\"", "\"\"")}\"" : value;
}
