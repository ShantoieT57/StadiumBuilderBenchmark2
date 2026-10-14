using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Formatters;
using Microsoft.AspNetCore.Mvc.ModelBinding.Metadata;
using Microsoft.Extensions.Options;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Makes every key of a 400 validation problem the camelCase name the client sends, as documented
/// on the <c>ValidationProblem</c> schema in docs/TransactionApi.yaml: a query, route or form
/// parameter by its name; a JSON body member by its path within the body (e.g.
/// <c>corrections[0].amount</c>); and a problem with the body as a whole by <see cref="WholeBody"/>.
/// </summary>
/// <remarks>
/// Parameters are bound under their own (already camelCase) names, so only the request body needs
/// configuring, in three places that between them produce every body error:
/// <list type="number">
/// <item><see cref="JsonNameValidationKeyProvider"/> keys model validation (e.g. a missing required
/// member) by the members' JSON names instead of their C# property names;</item>
/// <item><see cref="JsonBodyInputFormatter"/> keys errors reading the JSON;</item>
/// <item><see cref="WholeBodyErrorKeyFilter"/> moves the errors that model binding reports about the
/// body parameter itself (an empty or unreadable body) to <see cref="WholeBody"/>.</item>
/// </list>
/// Error messages are never changed.
/// </remarks>
public static class ValidationErrorKeys
{
    /// <summary>The key of a problem with the request body as a whole: the JSON path of the whole body.</summary>
    public const string WholeBody = "$";

    private const string MemberPathPrefix = "$.";

    public static IServiceCollection AddCamelCaseValidationErrorKeys(this IServiceCollection services)
    {
        services
            .AddOptions<MvcOptions>()
            .Configure<IOptions<JsonOptions>>((mvc, json) =>
            {
                mvc.ModelMetadataDetailsProviders.Add(new JsonNameValidationKeyProvider());
                ReplaceJsonInputFormatter(mvc.InputFormatters, new JsonBodyInputFormatter(json.Value));
                mvc.Filters.Add(new WholeBodyErrorKeyFilter());
            });
        return services;
    }

    /// <summary>
    /// The key of a body member from a System.Text.Json path: the path within the body, without the
    /// leading <c>$.</c> (<c>$.corrections[0].amount</c> becomes <c>corrections[0].amount</c>).
    /// </summary>
    public static string FromJsonPath(string? jsonPath) =>
        jsonPath is not null && jsonPath.StartsWith(MemberPathPrefix, StringComparison.Ordinal)
            ? jsonPath[MemberPathPrefix.Length..]
            : WholeBody;

    private static void ReplaceJsonInputFormatter(FormatterCollection<IInputFormatter> formatters, JsonBodyInputFormatter replacement)
    {
        var index = formatters.IndexOf(formatters.OfType<SystemTextJsonInputFormatter>().Single());
        formatters[index] = replacement;
    }

    /// <summary>
    /// Only the validation half of <see cref="SystemTextJsonValidationMetadataProvider"/>: it keys
    /// validation errors by the members' JSON names. Its display half is left out because it would
    /// also rename the property inside the messages ("The email field is required." instead of
    /// "The Email field is required."), and messages must not change.
    /// </summary>
    private sealed class JsonNameValidationKeyProvider : IValidationMetadataProvider
    {
        private readonly SystemTextJsonValidationMetadataProvider _jsonNames = new();

        public void CreateValidationMetadata(ValidationMetadataProviderContext context) =>
            _jsonNames.CreateValidationMetadata(context);
    }
}
