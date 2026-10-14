using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Formatters;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Reads JSON request bodies as ASP.NET Core's <see cref="SystemTextJsonInputFormatter"/> does, for
/// the same media types and encodings and with the same error messages, but keys a body that
/// cannot be read the way every other validation error is keyed (see <see cref="ValidationErrorKeys"/>):
/// <list type="bullet">
/// <item>JSON that is not well formed is a problem with the body as a whole, so it is keyed
/// <see cref="ValidationErrorKeys.WholeBody"/>, wherever in the text the reader stopped.</item>
/// <item>A well-formed value that cannot be converted (e.g. a number sent for a text member) is
/// keyed by the member's path within the body, e.g. <c>corrections[0].amount</c>; a body that is
/// not a JSON object is keyed <see cref="ValidationErrorKeys.WholeBody"/>.</item>
/// </list>
/// It replaces <see cref="SystemTextJsonInputFormatter"/>, whose reading cannot be overridden.
/// </summary>
public sealed class JsonBodyInputFormatter : TextInputFormatter, IInputFormatterExceptionPolicy
{
    private readonly JsonOptions _options;

    public JsonBodyInputFormatter(JsonOptions options)
    {
        _options = options;
        SupportedEncodings.Add(UTF8EncodingWithoutBOM);
        SupportedEncodings.Add(UTF16EncodingLittleEndian);
        SupportedMediaTypes.Add("application/json");
        SupportedMediaTypes.Add("text/json");
        SupportedMediaTypes.Add("application/*+json");
    }

    public InputFormatterExceptionPolicy ExceptionPolicy => InputFormatterExceptionPolicy.MalformedInputExceptions;

    public override async Task<InputFormatterResult> ReadRequestBodyAsync(InputFormatterContext context, Encoding encoding)
    {
        var body = context.HttpContext.Request.Body;
        var utf8Body = encoding.CodePage == Encoding.UTF8.CodePage
            ? body
            : Encoding.CreateTranscodingStream(body, encoding, Encoding.UTF8, leaveOpen: true);

        object? model;
        try
        {
            model = await JsonSerializer.DeserializeAsync(
                utf8Body, context.ModelType, _options.JsonSerializerOptions, context.HttpContext.RequestAborted);
        }
        catch (JsonException exception)
        {
            context.ModelState.TryAddModelError(KeyOf(exception), ForModelState(exception), context.Metadata);
            return InputFormatterResult.Failure();
        }
        catch (Exception exception) when (exception is FormatException or OverflowException)
        {
            // Only a custom converter throws these; like the base formatter, their messages are shown.
            context.ModelState.TryAddModelError(ValidationErrorKeys.WholeBody, exception, context.Metadata);
            return InputFormatterResult.Failure();
        }
        finally
        {
            if (!ReferenceEquals(utf8Body, body))
            {
                await utf8Body.DisposeAsync();
            }
        }

        return model is null && !context.TreatEmptyInputAsDefaultValue
            ? InputFormatterResult.NoValue()
            : InputFormatterResult.Success(model);
    }

    /// <summary>
    /// A reader error (JSON that is not well formed) reaches the serializer's caller wrapped in a
    /// <see cref="JsonException"/> whose inner exception is the reader's own <see cref="JsonException"/>.
    /// </summary>
    private static string KeyOf(JsonException exception) => exception.InnerException is JsonException
        ? ValidationErrorKeys.WholeBody
        : ValidationErrorKeys.FromJsonPath(exception.Path);

    /// <summary>
    /// As the base formatter does, the message is shown to the client (wrapped in an
    /// <see cref="InputFormatterException"/>) unless <see cref="JsonOptions.AllowInputFormatterExceptionMessages"/>
    /// is off, in which case the generic "The input was not valid." is shown instead.
    /// </summary>
    private Exception ForModelState(JsonException exception) => _options.AllowInputFormatterExceptionMessages
        ? new InputFormatterException(exception.Message, exception)
        : exception;
}
