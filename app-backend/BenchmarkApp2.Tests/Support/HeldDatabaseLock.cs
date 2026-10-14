using Dapper;
using Npgsql;

namespace BenchmarkApp2.Tests.Support;

/// <summary>
/// Another database session that holds row locks in an open transaction until the scenario releases
/// them. Requests that need those rows queue up behind it, so a scenario can line several requests
/// up and then let them go at the same moment, or in a chosen order.
/// </summary>
public sealed class HeldDatabaseLock : IAsyncDisposable
{
    private static readonly TimeSpan WaitingTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(20);

    private NpgsqlConnection? _connection;
    private NpgsqlTransaction? _transaction;

    /// <summary>Locks the transaction row as an update would (<c>FOR UPDATE</c>).</summary>
    public Task LockTransactionAsync(Guid transactionId) =>
        LockAsync("SELECT id FROM transactions WHERE id = @id FOR UPDATE", transactionId);

    /// <summary>Locks the file row as processing, correcting and cancelling do (<c>FOR NO KEY UPDATE</c>).</summary>
    public Task LockFileAsync(Guid fileId) =>
        LockAsync("SELECT id FROM files WHERE id = @id FOR NO KEY UPDATE", fileId);

    /// <summary>Ends the transaction without changing anything, releasing every lock it holds.</summary>
    public async Task ReleaseAsync()
    {
        if (_transaction is null)
        {
            throw new InvalidOperationException("No lock is held.");
        }
        await _transaction.RollbackAsync();
        await DisposeAsync();
    }

    /// <summary>
    /// Waits until exactly this many other sessions of the test database are blocked waiting for a
    /// lock, so the scenario knows each request it started has reached the point where it waits.
    /// </summary>
    public static async Task WaitForSessionsWaitingAsync(int count)
    {
        const string sql = """
            SELECT count(*)::int
            FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()
            """;
        await using var connection = new NpgsqlConnection(TestDatabase.ConnectionString);
        await connection.OpenAsync();
        var deadline = DateTime.UtcNow + WaitingTimeout;
        int waiting;
        while ((waiting = await connection.ExecuteScalarAsync<int>(sql)) != count)
        {
            if (DateTime.UtcNow > deadline)
            {
                Assert.Fail($"Expected {count} sessions to be waiting for a lock, but {waiting} were.");
            }
            await Task.Delay(PollInterval);
        }
    }

    private async Task LockAsync(string sql, Guid id)
    {
        if (_connection is null)
        {
            _connection = new NpgsqlConnection(TestDatabase.ConnectionString);
            await _connection.OpenAsync();
            _transaction = await _connection.BeginTransactionAsync();
        }
        Assert.Equal(id, await _connection.QuerySingleAsync<Guid>(sql, new { id }, _transaction));
    }

    public async ValueTask DisposeAsync()
    {
        if (_transaction is not null)
        {
            await _transaction.DisposeAsync();
            _transaction = null;
        }
        if (_connection is not null)
        {
            await _connection.DisposeAsync();
            _connection = null;
        }
    }
}
