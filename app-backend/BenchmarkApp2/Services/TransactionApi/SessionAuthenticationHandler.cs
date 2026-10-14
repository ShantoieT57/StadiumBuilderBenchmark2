using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Authenticates a request from the session cookie against the active sessions in the database,
/// and answers unauthenticated requests with a JSON 401 instead of a redirect.
/// </summary>
public sealed class SessionAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    SessionManager sessionManager)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Session";

    public const string SessionIdClaimType = "session_id";

    private const string NotSignedInMessage = "You are not signed in.";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!SessionCookie.TryRead(Request, out var token))
        {
            return AuthenticateResult.NoResult();
        }

        var session = await sessionManager.FindActiveSessionAsync(token, Context.RequestAborted);
        if (session is null)
        {
            return AuthenticateResult.Fail("The session is unknown or has ended.");
        }

        var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, session.UserId.ToString()),
                new Claim(ClaimTypes.Name, session.Name),
                new Claim(ClaimTypes.Email, session.Email),
                new Claim(ClaimTypes.Role, session.Role),
                new Claim(SessionIdClaimType, session.SessionId.ToString()),
            ],
            SchemeName);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
    }

    protected override async Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;
        await Response.WriteAsJsonAsync(new ErrorResponse { Message = NotSignedInMessage });
    }
}
