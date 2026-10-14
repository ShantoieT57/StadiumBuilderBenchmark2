using Dapper;
using Npgsql;

namespace BenchmarkApp2.Data;

/// <summary>The user an active session belongs to.</summary>
public sealed class SessionUserRecord
{
    public Guid SessionId { get; init; }
    public Guid UserId { get; init; }
    public string Name { get; init; } = string.Empty;
    public string Email { get; init; } = string.Empty;
    public string Role { get; init; } = string.Empty;
}

/// <summary>The values stored in <c>sessions.end_reason</c>.</summary>
public static class SessionEndReason
{
    public const string SignedOut = "SignedOut";
    public const string SignedInElsewhere = "SignedInElsewhere";
    public const string Expired = "Expired";
}

/// <summary>
/// Database access for the sessions table. Sessions are looked up by token hash only. Every method
/// takes the current time and the inactivity timeout, so a session whose last activity is at least
/// the timeout ago is treated as expired, and is recorded as such whenever it is ended.
/// </summary>
public sealed class SessionRepository(NpgsqlDataSource dataSource)
{
    /// <summary>
    /// Ends the selected active sessions with @endReason, except those that had already timed out,
    /// which are recorded as expired at the moment their timeout elapsed.
    /// </summary>
    private const string EndActiveSessionsSql = $"""
        UPDATE sessions
        SET ended_at   = CASE WHEN last_activity_at <= @cutoff THEN last_activity_at + @timeout ELSE @now END,
            end_reason = CASE WHEN last_activity_at <= @cutoff THEN '{SessionEndReason.Expired}' ELSE @endReason END
        WHERE ended_at IS NULL
        """;

    /// <summary>
    /// Starts a session for the user and ends all of the user's other active sessions, so a person
    /// is signed in in one place at a time. The user's row is locked so concurrent sign-ins by the
    /// same person cannot both stay active.
    /// </summary>
    public async Task StartSingleAsync(Guid userId, byte[] tokenHash, DateTimeOffset now, TimeSpan timeout, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        await connection.ExecuteAsync(new CommandDefinition(
            "SELECT 1 FROM users WHERE id = @userId FOR UPDATE", new { userId }, transaction, cancellationToken: cancellationToken));
        await connection.ExecuteAsync(new CommandDefinition(
            $"{EndActiveSessionsSql} AND user_id = @userId",
            new { userId, now, timeout, cutoff = now - timeout, endReason = SessionEndReason.SignedInElsewhere },
            transaction,
            cancellationToken: cancellationToken));
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO sessions (user_id, token_hash, created_at, last_activity_at)
            VALUES (@userId, @tokenHash, @now, @now)
            """,
            new { userId, tokenHash, now },
            transaction,
            cancellationToken: cancellationToken));

        await transaction.CommitAsync(cancellationToken);
    }

    /// <summary>
    /// Records activity on a session that is active and has not timed out, and returns its user.
    /// Returns null, without changing anything, when there is no such session.
    /// </summary>
    public async Task<SessionUserRecord?> TouchActiveAsync(byte[] tokenHash, DateTimeOffset now, TimeSpan timeout, CancellationToken cancellationToken)
    {
        const string sql = """
            UPDATE sessions s
            SET last_activity_at = @now
            FROM users u
            WHERE u.id = s.user_id
              AND s.token_hash = @tokenHash
              AND s.ended_at IS NULL
              AND s.last_activity_at > @cutoff
            RETURNING s.id AS SessionId, u.id AS UserId, u.name, u.email, u.role
            """;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<SessionUserRecord>(new CommandDefinition(
            sql, new { tokenHash, now, cutoff = now - timeout }, cancellationToken: cancellationToken));
    }

    /// <summary>
    /// Ends the session as expired if it is still recorded as active but has timed out, then returns
    /// why the session ended. Returns null when no session has this token hash.
    /// </summary>
    public async Task<string?> ExpireAndGetEndReasonAsync(byte[] tokenHash, DateTimeOffset now, TimeSpan timeout, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            $"{EndActiveSessionsSql} AND token_hash = @tokenHash",
            new { tokenHash, now, timeout, cutoff = now - timeout, endReason = SessionEndReason.Expired },
            cancellationToken: cancellationToken));
        return await connection.QuerySingleOrDefaultAsync<string?>(new CommandDefinition(
            "SELECT end_reason FROM sessions WHERE token_hash = @tokenHash", new { tokenHash }, cancellationToken: cancellationToken));
    }

    /// <summary>
    /// Ends every active session of the user whose session has this token hash, provided that
    /// session is itself still active and has not timed out. A token whose session has already
    /// ended therefore cannot end the person's newer sessions.
    /// </summary>
    public async Task EndAllSessionsOfActiveSessionOwnerAsync(byte[] tokenHash, string endReason, DateTimeOffset now, TimeSpan timeout, CancellationToken cancellationToken)
    {
        const string ownerOfActiveSessionSql = """
            AND user_id = (
                SELECT user_id FROM sessions
                WHERE token_hash = @tokenHash
                  AND ended_at IS NULL
                  AND last_activity_at > @cutoff)
            """;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            $"{EndActiveSessionsSql} {ownerOfActiveSessionSql}",
            new { tokenHash, endReason, now, timeout, cutoff = now - timeout },
            cancellationToken: cancellationToken));
    }
}
