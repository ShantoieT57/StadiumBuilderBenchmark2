using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Moves the errors model binding reports about a request body as a whole to
/// <see cref="ValidationErrorKeys.WholeBody"/>, keeping their messages. ASP.NET Core keys an empty
/// body by the empty key, and a body that could not be read (so the required body parameter has no
/// value) by the C# name of the body parameter, which the client never sees.
/// </summary>
/// <remarks>
/// Runs before the automatic 400 of <c>[ApiController]</c> (whose filter has the order -2000), so
/// that response and every <c>ValidationProblem</c> returned by an action see the moved keys.
/// </remarks>
public sealed class WholeBodyErrorKeyFilter : IActionFilter, IOrderedFilter
{
    public int Order => -3000;

    public void OnActionExecuting(ActionExecutingContext context)
    {
        var bodyParameter = context.ActionDescriptor.Parameters
            .FirstOrDefault(parameter => parameter.BindingInfo?.BindingSource == BindingSource.Body);
        if (bodyParameter is null || context.ModelState.IsValid)
        {
            return;
        }

        MoveErrors(context.ModelState, string.Empty);
        MoveErrors(context.ModelState, bodyParameter.BindingInfo?.BinderModelName ?? bodyParameter.Name);
    }

    public void OnActionExecuted(ActionExecutedContext context)
    {
    }

    private static void MoveErrors(ModelStateDictionary modelState, string key)
    {
        if (!modelState.TryGetValue(key, out var entry) || entry.Errors.Count == 0)
        {
            return;
        }

        foreach (var error in entry.Errors)
        {
            if (error.Exception is not null && string.IsNullOrEmpty(error.ErrorMessage))
            {
                modelState.TryAddModelException(ValidationErrorKeys.WholeBody, error.Exception);
            }
            else
            {
                modelState.AddModelError(ValidationErrorKeys.WholeBody, error.ErrorMessage);
            }
        }
        entry.Errors.Clear();
        entry.ValidationState = ModelValidationState.Skipped;
    }
}
