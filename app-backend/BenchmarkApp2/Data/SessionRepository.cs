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

/// <summary>Database access for the sessions table. Sessions are looked up by token hash only.</summary>
public sealed class SessionRepository(NpgsqlDataSource dataSource)
{
    public async Task CreateAsync(Guid userId, byte[] tokenHash, CancellationToken cancellationToken)
    {
        const string sql = "INSERT INTO sessions (user_id, token_hash) VALUES (@userId, @tokenHash)";
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(sql, new { userId, tokenHash }, cancellationToken: cancellationToken));
    }

    public async Task<SessionUserRecord?> FindActiveAsync(byte[] tokenHash, CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT s.id AS SessionId, u.id AS UserId, u.name, u.email, u.role
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = @tokenHash
              AND s.ended_at IS NULL
            """;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<SessionUserRecord>(new CommandDefinition(sql, new { tokenHash }, cancellationToken: cancellationToken));
    }

    public async Task EndAsync(byte[] tokenHash, string endReason, CancellationToken cancellationToken)
    {
        const string sql = """
            UPDATE sessions
            SET ended_at = now(), end_reason = @endReason
            WHERE token_hash = @tokenHash
              AND ended_at IS NULL
            """;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(sql, new { tokenHash, endReason }, cancellationToken: cancellationToken));
    }
}
