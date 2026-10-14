using BenchmarkApp2.Database;
using Dapper;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;

namespace BenchmarkApp2.Tests.Support;

/// <summary>
/// The real local PostgreSQL database the tests run against. It is dropped and re-created once per
/// test run, migrated with the application's own migration scripts, and cleaned between scenarios.
/// </summary>
public static class TestDatabase
{
    /// <summary>Overrides the default test connection string when set.</summary>
    private const string ConnectionStringVariable = "BENCHMARKAPP2_TEST_DATABASE";

    private const string DefaultConnectionString =
        "Host=localhost;Port=5433;Database=benchmark_app_2_tests;Username=postgres;Password=postgres";

    public static string ConnectionString { get; } =
        Environment.GetEnvironmentVariable(ConnectionStringVariable) ?? DefaultConnectionString;

    public static async Task RecreateAsync()
    {
        var builder = new NpgsqlConnectionStringBuilder(ConnectionString);
        var databaseName = builder.Database!;
        builder.Database = "postgres";

        await using (var adminConnection = new NpgsqlConnection(builder.ConnectionString))
        {
            await adminConnection.ExecuteAsync($"""DROP DATABASE IF EXISTS "{databaseName}" WITH (FORCE)""");
            await adminConnection.ExecuteAsync($"""CREATE DATABASE "{databaseName}" """);
        }

        await using var dataSource = NpgsqlDataSource.Create(ConnectionString);
        await new Migrator(dataSource, NullLogger<Migrator>.Instance).MigrateAsync(CancellationToken.None);
    }

    /// <summary>Removes data written by scenarios, leaving the seeded users in place.</summary>
    public static async Task ResetAsync()
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.ExecuteAsync("DELETE FROM files; DELETE FROM sessions");
    }

    /// <summary>
    /// Adds an active session for a user directly, bypassing sign-in (which would end the user's other
    /// sessions), to represent a session that is open on another device.
    /// </summary>
    public static async Task InsertActiveSessionAsync(string email, byte[] tokenHash, DateTimeOffset now)
    {
        const string sql = """
            INSERT INTO sessions (user_id, token_hash, created_at, last_activity_at)
            SELECT id, @tokenHash, @now, @now FROM users WHERE lower(email) = lower(@email)
            """;
        await using var connection = new NpgsqlConnection(ConnectionString);
        Assert.Equal(1, await connection.ExecuteAsync(sql, new { email, tokenHash, now }));
    }

    /// <summary>The recorded end reason of a session, or null while the session is still active.</summary>
    public static async Task<string?> GetSessionEndReasonAsync(byte[] tokenHash)
    {
        const string sql = "SELECT end_reason FROM sessions WHERE token_hash = @tokenHash";
        await using var connection = new NpgsqlConnection(ConnectionString);
        return await connection.QuerySingleAsync<string?>(sql, new { tokenHash });
    }

    /// <summary>Every stored file, with the email address of the person who uploaded it.</summary>
    public static async Task<IReadOnlyList<StoredFile>> GetStoredFilesAsync()
    {
        const string sql = """
            SELECT f.id, f.file_name AS FileName, f.kind, f.status, f.content,
                   f.content_sha256 AS ContentSha256, u.email AS UploadedByEmail, f.uploaded_at AS UploadedAt
            FROM files f
            JOIN users u ON u.id = f.uploaded_by
            """;
        await using var connection = new NpgsqlConnection(ConnectionString);
        return (await connection.QueryAsync<StoredFile>(sql)).ToList();
    }
}

public sealed class StoredFile
{
    public Guid Id { get; init; }
    public string FileName { get; init; } = string.Empty;
    public string Kind { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public byte[] Content { get; init; } = [];
    public byte[] ContentSha256 { get; init; } = [];
    public string UploadedByEmail { get; init; } = string.Empty;
    public DateTime UploadedAt { get; init; }
}
