using BenchmarkApp2.Data;
using Microsoft.AspNetCore.Identity;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>A newly started session: the token to hand back in the cookie and the signed-in user.</summary>
public sealed record SignedInSession(string Token, UserRecord User);

/// <summary>
/// The outcome of authenticating a session token: the signed-in user, or why the token does not
/// authenticate.
/// </summary>
public sealed record SessionAuthentication(SessionUserRecord? User, UnauthenticatedReason FailureReason)
{
    public static SessionAuthentication Succeeded(SessionUserRecord user) => new(user, default);

    public static SessionAuthentication Failed(UnauthenticatedReason reason) => new(null, reason);
}

/// <summary>
/// Verifies credentials and starts, uses and ends server-side sessions. A person is signed in in
/// one place at a time (SI-07), a session expires after the configured period without activity
/// (SI-06), and signing out ends the person's sessions on every device (SI-08).
/// </summary>
public sealed class SessionManager(
    UserRepository users,
    SessionRepository sessions,
    IPasswordHasher<UserRecord> passwordHasher,
    AppSettings settings,
    TimeProvider timeProvider)
{
    /// <summary>
    /// Verified against when the email address is unknown, so an unknown email takes about as long
    /// to refuse as a wrong password and response timing does not reveal which was wrong.
    /// </summary>
    private readonly string _unknownUserPasswordHash = passwordHasher.HashPassword(new UserRecord(), Guid.NewGuid().ToString());

    private TimeSpan InactivityTimeout => TimeSpan.FromMinutes(settings.SessionInactivityTimeoutMinutes);

    /// <summary>
    /// Returns the new session, or null when the email address or password is wrong. Ends the
    /// person's other sessions.
    /// </summary>
    public async Task<SignedInSession?> SignInAsync(string email, string password, CancellationToken cancellationToken)
    {
        var user = await users.FindByEmailAsync(email.Trim(), cancellationToken);
        if (user is null)
        {
            passwordHasher.VerifyHashedPassword(new UserRecord(), _unknownUserPasswordHash, password);
            return null;
        }

        if (passwordHasher.VerifyHashedPassword(user, user.PasswordHash, password) == PasswordVerificationResult.Failed)
        {
            return null;
        }

        var token = SessionCookie.CreateToken();
        await sessions.StartSingleAsync(user.Id, SessionCookie.HashToken(token), timeProvider.GetUtcNow(), InactivityTimeout, cancellationToken);
        return new SignedInSession(token, user);
    }

    /// <summary>
    /// Authenticates a session token. When <paramref name="countsAsActivity"/>, a successful
    /// authentication restarts the inactivity timeout; otherwise (e.g. for the event stream and its
    /// heartbeat checks) the session is only checked and its timeout keeps running.
    /// </summary>
    public async Task<SessionAuthentication> AuthenticateAsync(string token, bool countsAsActivity, CancellationToken cancellationToken)
    {
        var tokenHash = SessionCookie.HashToken(token);
        var now = timeProvider.GetUtcNow();

        var user = countsAsActivity
            ? await sessions.TouchActiveAsync(tokenHash, now, InactivityTimeout, cancellationToken)
            : await sessions.FindActiveAsync(tokenHash, now, InactivityTimeout, cancellationToken);
        if (user is not null)
        {
            return SessionAuthentication.Succeeded(user);
        }

        var endReason = await sessions.ExpireAndGetEndReasonAsync(tokenHash, now, InactivityTimeout, cancellationToken);
        return SessionAuthentication.Failed(ToUnauthenticatedReason(endReason));
    }

    /// <summary>Ends every active session of the person the token belongs to, if its session is active.</summary>
    public Task SignOutAsync(string token, CancellationToken cancellationToken) =>
        sessions.EndAllSessionsOfActiveSessionOwnerAsync(
            SessionCookie.HashToken(token), SessionEndReason.SignedOut, timeProvider.GetUtcNow(), InactivityTimeout, cancellationToken);

    /// <summary>The message telling a person why they are not (or no longer) signed in.</summary>
    public string DescribeUnauthenticated(UnauthenticatedReason reason) => reason switch
    {
        UnauthenticatedReason.SessionExpired =>
            $"Your session has expired after {settings.SessionInactivityTimeoutMinutes} minutes of inactivity. Please sign in again.",
        UnauthenticatedReason.SignedInElsewhere => "You have been signed out because you signed in somewhere else.",
        UnauthenticatedReason.SignedOut => "You have been signed out. Please sign in again.",
        _ => "You are not signed in.",
    };

    private static UnauthenticatedReason ToUnauthenticatedReason(string? endReason) => endReason switch
    {
        SessionEndReason.Expired => UnauthenticatedReason.SessionExpired,
        SessionEndReason.SignedInElsewhere => UnauthenticatedReason.SignedInElsewhere,
        SessionEndReason.SignedOut => UnauthenticatedReason.SignedOut,
        _ => UnauthenticatedReason.NotSignedIn,
    };
}
