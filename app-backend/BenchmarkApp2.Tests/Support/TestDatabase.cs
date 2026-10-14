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
        await connection.ExecuteAsync("DELETE FROM sessions");
    }
}
