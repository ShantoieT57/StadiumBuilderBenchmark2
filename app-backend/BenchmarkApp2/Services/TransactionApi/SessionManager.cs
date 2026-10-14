using BenchmarkApp2.Data;
using Microsoft.AspNetCore.Identity;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>A newly started session: the token to hand back in the cookie and the signed-in user.</summary>
public sealed record SignedInSession(string Token, UserRecord User);

/// <summary>Verifies credentials and starts and ends server-side sessions.</summary>
public sealed class SessionManager(UserRepository users, SessionRepository sessions, IPasswordHasher<UserRecord> passwordHasher)
{
    private const string SignedOutReason = "SignedOut";

    /// <summary>
    /// Verified against when the email address is unknown, so an unknown email takes about as long
    /// to refuse as a wrong password and response timing does not reveal which was wrong.
    /// </summary>
    private readonly string _unknownUserPasswordHash = passwordHasher.HashPassword(new UserRecord(), Guid.NewGuid().ToString());

    /// <summary>Returns the new session, or null when the email address or password is wrong.</summary>
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
        await sessions.CreateAsync(user.Id, SessionCookie.HashToken(token), cancellationToken);
        return new SignedInSession(token, user);
    }

    public Task<SessionUserRecord?> FindActiveSessionAsync(string token, CancellationToken cancellationToken) =>
        sessions.FindActiveAsync(SessionCookie.HashToken(token), cancellationToken);

    public Task SignOutAsync(string token, CancellationToken cancellationToken) =>
        sessions.EndAsync(SessionCookie.HashToken(token), SignedOutReason, cancellationToken);
}
