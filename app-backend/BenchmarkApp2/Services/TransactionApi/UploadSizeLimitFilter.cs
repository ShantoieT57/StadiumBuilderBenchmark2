using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Refuses an upload with 413 and a readable message when any file in the multipart form is larger
/// than <see cref="AppSettings.MaxUploadSizeBytes"/>. The request body is capped just above that
/// size, so the server stops reading an oversized request instead of buffering all of it.
/// </summary>
public sealed class UploadSizeLimitFilter(AppSettings settings) : IAsyncResourceFilter
{
    /// <summary>Room for the multipart boundaries, part headers and other form fields.</summary>
    private const long MultipartOverheadBytes = 64 * 1024;

    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        var httpContext = context.HttpContext;
        if (httpContext.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } bodySizeFeature)
        {
            bodySizeFeature.MaxRequestBodySize = settings.MaxUploadSizeBytes + MultipartOverheadBytes;
        }

        if (httpContext.Request.HasFormContentType)
        {
            IFormCollection form;
            try
            {
                form = await httpContext.Request.ReadFormAsync(httpContext.RequestAborted);
            }
            catch (BadHttpRequestException exception) when (exception.StatusCode == StatusCodes.Status413PayloadTooLarge)
            {
                context.Result = FileTooLarge();
                return;
            }

            if (form.Files.Any(file => file.Length > settings.MaxUploadSizeBytes))
            {
                context.Result = FileTooLarge();
                return;
            }
        }

        await next();
    }

    private ObjectResult FileTooLarge() => new(new ErrorResponse
    {
        Message = $"The file is too large. Files can be up to {FormatSize(settings.MaxUploadSizeBytes)}.",
    })
    {
        StatusCode = StatusCodes.Status413PayloadTooLarge,
    };

    private static string FormatSize(long bytes) => bytes switch
    {
        >= 1024 * 1024 when bytes % (1024 * 1024) == 0 => $"{bytes / (1024 * 1024)} MB",
        >= 1024 when bytes % 1024 == 0 => $"{bytes / 1024} KB",
        _ => $"{bytes} bytes",
    };
}
