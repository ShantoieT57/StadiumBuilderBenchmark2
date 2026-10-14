using Dapper;
using Npgsql;

namespace BenchmarkApp2.Data;

public sealed class UserRecord
{
    public Guid Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public string Email { get; init; } = string.Empty;
    public string Role { get; init; } = string.Empty;
    public string PasswordHash { get; init; } = string.Empty;
}

/// <summary>Database access for the users table.</summary>
public sealed class UserRepository(NpgsqlDataSource dataSource)
{
    /// <summary>Finds a user by email address, ignoring upper and lower case.</summary>
    public async Task<UserRecord?> FindByEmailAsync(string email, CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT id, name, email, role, password_hash AS PasswordHash
            FROM users
            WHERE lower(email) = lower(@email)
            """;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<UserRecord>(new CommandDefinition(sql, new { email }, cancellationToken: cancellationToken));
    }
}
