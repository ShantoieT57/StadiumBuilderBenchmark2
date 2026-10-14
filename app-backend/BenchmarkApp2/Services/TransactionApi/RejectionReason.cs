using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Checks the reason given for rejecting a transaction (RJ-01, RJ-02). Whitespace at the start and
/// end is removed first, and the trimmed reason is the one checked and stored. Its length is counted
/// in UTF-16 code units (<see cref="string.Length"/>), as a JavaScript string's <c>length</c> counts
/// it, so a reason the front-end limits to 500 characters as typed is always accepted.
/// </summary>
public static class RejectionReason
{
    public const int MaxLength = 500;

    /// <summary>
    /// The key validation errors about the reason are reported under. It is the model property's
    /// name, the same key model validation uses when the reason is missing, so every problem with
    /// the reason is reported under one key.
    /// </summary>
    public const string Field = nameof(RejectTransactionRequest.Reason);

    /// <summary>
    /// The trimmed reason, or null when it is missing, only whitespace or too long, in which case
    /// the problem is added to <paramref name="errors"/>.
    /// </summary>
    public static string? Check(string? reason, ModelStateDictionary errors)
    {
        var trimmed = reason?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            errors.AddModelError(Field, "A reason is required to reject a transaction.");
            return null;
        }
        if (trimmed.Length > MaxLength)
        {
            errors.AddModelError(Field, $"The reason can be at most {MaxLength} characters.");
            return null;
        }
        return trimmed;
    }
}
