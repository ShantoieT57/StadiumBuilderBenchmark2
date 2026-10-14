using System.Reflection;
using Dapper;
using Npgsql;

namespace BenchmarkApp2.Database;

/// <summary>
/// Applies the embedded SQL migration scripts (Database/Migrations/*.sql) that have not yet been
/// applied, in file-name order, each in its own transaction. Runs once at application startup.
/// </summary>
public sealed class Migrator(NpgsqlDataSource dataSource, ILogger<Migrator> logger)
{
    private const string ResourcePrefix = "Migrations/";

    /// <summary>Serialises concurrent migrators against the same database.</summary>
    private const long AdvisoryLockKey = 0x42_41_32_4D_49_47; // "BA2MIG"

    private const string CreateHistoryTableSql = """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            script_name text        PRIMARY KEY,
            applied_at  timestamptz NOT NULL DEFAULT now()
        )
        """;

    public async Task MigrateAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition("SELECT pg_advisory_lock(@AdvisoryLockKey)", new { AdvisoryLockKey }, cancellationToken: cancellationToken));
        try
        {
            await connection.ExecuteAsync(new CommandDefinition(CreateHistoryTableSql, cancellationToken: cancellationToken));
            var applied = (await connection.QueryAsync<string>(new CommandDefinition("SELECT script_name FROM schema_migrations", cancellationToken: cancellationToken))).ToHashSet();

            foreach (var script in LoadScripts().Where(script => !applied.Contains(script.Name)))
            {
                await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
                await connection.ExecuteAsync(new CommandDefinition(script.Sql, transaction: transaction, cancellationToken: cancellationToken));
                await connection.ExecuteAsync(new CommandDefinition(
                    "INSERT INTO schema_migrations (script_name) VALUES (@Name)", new { script.Name }, transaction, cancellationToken: cancellationToken));
                await transaction.CommitAsync(cancellationToken);
                logger.LogInformation("Applied database migration script {ScriptName}.", script.Name);
            }
        }
        finally
        {
            await connection.ExecuteAsync("SELECT pg_advisory_unlock(@AdvisoryLockKey)", new { AdvisoryLockKey });
        }
    }

    private static IEnumerable<(string Name, string Sql)> LoadScripts()
    {
        var assembly = Assembly.GetExecutingAssembly();
        foreach (var resourceName in assembly.GetManifestResourceNames()
                     .Where(name => name.StartsWith(ResourcePrefix, StringComparison.Ordinal))
                     .Order(StringComparer.Ordinal))
        {
            using var reader = new StreamReader(assembly.GetManifestResourceStream(resourceName)!);
            yield return (resourceName[ResourcePrefix.Length..], reader.ReadToEnd());
        }
    }
}
