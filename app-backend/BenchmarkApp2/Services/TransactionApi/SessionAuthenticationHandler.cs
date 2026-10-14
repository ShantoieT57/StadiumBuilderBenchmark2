using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Authenticates a request from the session cookie against the active sessions in the database,
/// and answers unauthenticated requests with a JSON 401 instead of a redirect. The 401 says why the
/// request was not authenticated, so the front-end can tell an ended session from never signing in.
/// </summary>
public sealed class SessionAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    SessionManager sessionManager,
    AppSettings settings)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Session";

    public const string SessionIdClaimType = "session_id";

    /// <summary>The authentication property that carries the <see cref="UnauthenticatedReason"/> to the challenge.</summary>
    private const string FailureReasonProperty = "failure_reason";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!SessionCookie.TryRead(Request, out var token))
        {
            return AuthenticateResult.NoResult();
        }

        var authentication = await sessionManager.AuthenticateAsync(token, Context.RequestAborted);
        if (authentication.User is not { } session)
        {
            var properties = new AuthenticationProperties();
            properties.Items[FailureReasonProperty] = authentication.FailureReason.ToString();
            return AuthenticateResult.Fail("The session is unknown or has ended.", properties);
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
        var result = await HandleAuthenticateOnceSafeAsync();
        var reason = result.Properties?.Items.TryGetValue(FailureReasonProperty, out var value) == true
            ? Enum.Parse<UnauthenticatedReason>(value!)
            : UnauthenticatedReason.NotSignedIn;

        Response.StatusCode = StatusCodes.Status401Unauthorized;
        await Response.WriteAsJsonAsync(new UnauthenticatedResponse { Reason = reason, Message = GetMessage(reason) });
    }

    private string GetMessage(UnauthenticatedReason reason) => reason switch
    {
        UnauthenticatedReason.SessionExpired =>
            $"Your session has expired after {settings.SessionInactivityTimeoutMinutes} minutes of inactivity. Please sign in again.",
        UnauthenticatedReason.SignedInElsewhere => "You have been signed out because you signed in somewhere else.",
        UnauthenticatedReason.SignedOut => "You have been signed out. Please sign in again.",
        _ => "You are not signed in.",
    };
}
