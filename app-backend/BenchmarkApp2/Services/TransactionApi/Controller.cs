using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Implements the TransactionApi operations generated from docs/TransactionApi.yaml.
/// Every operation requires a signed-in session (the fallback policy) unless marked anonymous.
/// </summary>
/// <remarks>
/// The empty route replaces the generated base controller's route, which NSwag derives from the
/// spec's server URL. Routes must stay relative to the path base configured at runtime instead.
/// </remarks>
[ApiController]
[Route("")]
public sealed class Controller(SessionManager sessionManager) : ControllerBase
{
    private const string InvalidCredentialsMessage = "Invalid email or password";

    [AllowAnonymous]
    public override async Task<ActionResult<CurrentUser>> SignIn(SignInRequest body, CancellationToken cancellationToken = default)
    {
        var session = await sessionManager.SignInAsync(body.Email, body.Password, cancellationToken);
        if (session is null)
        {
            return Unauthorized(new ErrorResponse { Message = InvalidCredentialsMessage });
        }

        SessionCookie.Append(Response, session.Token);
        return ToCurrentUser(session.User.Name, session.User.Email, session.User.Role);
    }

    public override Task<ActionResult<CurrentUser>> GetCurrentUser(CancellationToken cancellationToken = default)
    {
        var currentUser = ToCurrentUser(
            User.FindFirstValue(ClaimTypes.Name)!,
            User.FindFirstValue(ClaimTypes.Email)!,
            User.FindFirstValue(ClaimTypes.Role)!);
        return Task.FromResult<ActionResult<CurrentUser>>(currentUser);
    }

    /// <summary>Anonymous and idempotent, so a person can always sign out even with an ended session.</summary>
    [AllowAnonymous]
    public override async Task<IActionResult> SignOut(CancellationToken cancellationToken = default)
    {
        if (SessionCookie.TryRead(Request, out var token))
        {
            await sessionManager.SignOutAsync(token, cancellationToken);
        }

        SessionCookie.Delete(Response);
        return NoContent();
    }

    private static CurrentUser ToCurrentUser(string name, string email, string role) => new()
    {
        Name = name,
        Email = email,
        Role = Enum.Parse<UserRole>(role),
    };
}
