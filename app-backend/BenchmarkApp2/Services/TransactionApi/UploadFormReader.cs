using System.Text;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Net.Http.Headers;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>A part of an upload request is larger than the maximum upload size.</summary>
public sealed class UploadPartTooLargeException() : Exception("A part of the upload request is larger than the maximum upload size.");

/// <summary>
/// Reads the multipart/form-data body of an upload request into a form, in place of ASP.NET Core's
/// form reader, so that every part is measured in exact bytes against the maximum upload size.
/// </summary>
/// <remarks>
/// A part is a file whenever its <c>Content-Disposition</c> has a <c>filename</c> or
/// <c>filename*</c> parameter, even an empty one. ASP.NET Core's form reader treats a part sent
/// with <c>filename=""</c> as a plain form value instead, which escapes the per-file size check.
/// A part's content is never read past one byte more than the limit.
/// </remarks>
public static class UploadFormReader
{
    private const string FormDataDisposition = "form-data";

    /// <exception cref="UploadPartTooLargeException">Any part is larger than <paramref name="maxPartBytes"/>.</exception>
    /// <exception cref="InvalidDataException">A part's headers cannot be read.</exception>
    /// <exception cref="IOException">The body ends before its closing boundary.</exception>
    public static async Task<IFormCollection> ReadAsync(Stream body, string boundary, long maxPartBytes, CancellationToken cancellationToken)
    {
        var reader = new MultipartReader(boundary, body);
        var values = new KeyValueAccumulator();
        var files = new FormFileCollection();

        while (await reader.ReadNextSectionAsync(cancellationToken) is { } section)
        {
            var content = await ReadPartAsync(section.Body, maxPartBytes, cancellationToken);
            if (!ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var disposition)
                || !disposition.DispositionType.Equals(FormDataDisposition, StringComparison.OrdinalIgnoreCase))
            {
                // Like ASP.NET Core's form reader, parts that are not form fields are ignored.
                continue;
            }

            var name = HeaderUtilities.RemoveQuotes(disposition.Name).ToString();
            if (IsFile(disposition))
            {
                files.Add(new FormFile(new MemoryStream(content), 0, content.Length, name, FileName(disposition))
                {
                    Headers = new HeaderDictionary(section.Headers ?? []),
                });
            }
            else
            {
                values.Append(name, Encoding.UTF8.GetString(content));
            }
        }

        return new FormCollection(values.HasValues ? values.GetResults() : null, files);
    }

    private static bool IsFile(ContentDispositionHeaderValue disposition) =>
        disposition.Parameters.Any(parameter =>
            parameter.Name.Equals("filename", StringComparison.OrdinalIgnoreCase)
            || parameter.Name.Equals("filename*", StringComparison.OrdinalIgnoreCase));

    /// <summary>The file name exactly as ASP.NET Core's form reader reports it.</summary>
    private static string FileName(ContentDispositionHeaderValue disposition) =>
        HeaderUtilities.RemoveQuotes(disposition.FileNameStar.HasValue ? disposition.FileNameStar : disposition.FileName).ToString();

    private static async Task<byte[]> ReadPartAsync(Stream part, long maxPartBytes, CancellationToken cancellationToken)
    {
        using var memory = new MemoryStream();
        var buffer = new byte[81920];
        int read;
        while ((read = await part.ReadAsync(buffer, cancellationToken)) > 0)
        {
            if (memory.Length + read > maxPartBytes)
            {
                throw new UploadPartTooLargeException();
            }
            memory.Write(buffer, 0, read);
        }
        return memory.ToArray();
    }
}
