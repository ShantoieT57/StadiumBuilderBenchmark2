using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Primitives;
using Microsoft.Net.Http.Headers;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Reads an upload request's form before it is bound, so that every malformed or oversized upload
/// is refused with a JSON message instead of failing. In order, it refuses a request that is not
/// multipart/form-data (415), a multipart body that cannot be read (400), any part larger than
/// <see cref="AppSettings.MaxUploadSizeBytes"/> (413) and more than one file (400). The form it
/// reads is then what model binding sees.
/// </summary>
/// <remarks>
/// The form is read with <see cref="UploadFormReader"/>, never with ASP.NET Core's form reader, so
/// none of the <c>FormOptions</c> limits apply to an upload and only the limits here decide the
/// response. The request body is also capped just above the maximum upload size, so the server
/// stops reading an oversized request instead of buffering all of it.
/// </remarks>
public sealed class UploadRequestFilter(AppSettings settings) : IAsyncResourceFilter
{
    /// <summary>The form field the file is sent in.</summary>
    public const string FileFieldName = "file";

    /// <summary>Room for the multipart boundaries, part headers and other form fields.</summary>
    private const long MultipartOverheadBytes = 64 * 1024;

    /// <summary>The longest boundary accepted, as for ASP.NET Core's form reader.</summary>
    private const int MaxBoundaryLength = 128;

    private const string MultipartFormData = "multipart/form-data";
    private const string NotMultipartMessage = "Files must be uploaded as multipart/form-data.";
    private const string UnreadableMessage = "The upload request could not be read. Please send the file as multipart/form-data.";
    private const string MoreThanOneFileMessage = "Upload one file at a time.";

    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        var httpContext = context.HttpContext;
        if (httpContext.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } bodySizeFeature)
        {
            bodySizeFeature.MaxRequestBodySize = settings.MaxUploadSizeBytes + MultipartOverheadBytes;
        }

        if (!MediaTypeHeaderValue.TryParse(httpContext.Request.ContentType, out var contentType)
            || !contentType.MediaType.Equals(MultipartFormData, StringComparison.OrdinalIgnoreCase))
        {
            context.Result = Refuse(StatusCodes.Status415UnsupportedMediaType, NotMultipartMessage);
            return;
        }

        var boundary = HeaderUtilities.RemoveQuotes(contentType.Boundary);
        if (StringSegment.IsNullOrEmpty(boundary) || boundary.Length > MaxBoundaryLength)
        {
            context.Result = Refuse(StatusCodes.Status400BadRequest, UnreadableMessage);
            return;
        }

        IFormCollection form;
        try
        {
            form = await UploadFormReader.ReadAsync(httpContext.Request.Body, boundary.ToString(), settings.MaxUploadSizeBytes, httpContext.RequestAborted);
        }
        catch (Exception exception) when (IsTooLarge(exception))
        {
            context.Result = FileTooLarge();
            return;
        }
        catch (Exception exception) when (IsUnreadable(exception))
        {
            context.Result = Refuse(StatusCodes.Status400BadRequest, UnreadableMessage);
            return;
        }

        // A plain form field named "file" is bound as a file without a name, so it counts as a file.
        if (form.Files.Count + form[FileFieldName].Count > 1)
        {
            context.Result = Refuse(StatusCodes.Status400BadRequest, MoreThanOneFileMessage);
            return;
        }

        httpContext.Features.Set<IFormFeature>(new FormFeature(form));
        await next();
    }

    private static bool IsTooLarge(Exception exception) =>
        exception is UploadPartTooLargeException
        || exception is BadHttpRequestException { StatusCode: StatusCodes.Status413PayloadTooLarge };

    /// <summary>
    /// A malformed multipart body: unreadable part headers (<see cref="InvalidDataException"/>), a
    /// body that ends early (<see cref="IOException"/>) or a request the server could not read.
    /// </summary>
    private static bool IsUnreadable(Exception exception) =>
        exception is InvalidDataException or IOException or BadHttpRequestException;

    private ObjectResult FileTooLarge() => Refuse(
        StatusCodes.Status413PayloadTooLarge,
        $"The file is too large. Files can be up to {FormatSize(settings.MaxUploadSizeBytes)}.");

    private static ObjectResult Refuse(int statusCode, string message) =>
        new(new ErrorResponse { Message = message }) { StatusCode = statusCode };

    private static string FormatSize(long bytes) => bytes switch
    {
        >= 1024 * 1024 when bytes % (1024 * 1024) == 0 => $"{bytes / (1024 * 1024)} MB",
        >= 1024 when bytes % 1024 == 0 => $"{bytes / 1024} KB",
        _ => $"{bytes} bytes",
    };
}
