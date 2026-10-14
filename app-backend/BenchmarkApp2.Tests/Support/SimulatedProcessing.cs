using Dapper;
using Npgsql;

namespace BenchmarkApp2.Tests.Support;

/// <summary>
/// Stands in for a file processor that is part-way through processing a file: it claims the file
/// (status Processing) and holds the file row locked in an open transaction, exactly as the real
/// processor's unit of work does, until the scenario lets it finish.
/// </summary>
public sealed class SimulatedProcessing : IAsyncDisposable
{
    private NpgsqlConnection? _connection;
    private NpgsqlTransaction? _transaction;
    private Guid _fileId;

    public async Task StartAsync(Guid fileId)
    {
        await TestDatabase.SetFileStatusAsync(fileId, "Processing");
        _fileId = fileId;
        _connection = new NpgsqlConnection(TestDatabase.ConnectionString);
        await _connection.OpenAsync();
        _transaction = await _connection.BeginTransactionAsync();
        await _connection.ExecuteAsync("SELECT id FROM files WHERE id = @fileId FOR NO KEY UPDATE", new { fileId }, _transaction);
    }

    /// <summary>Gives the file its final status and commits, releasing the lock.</summary>
    public async Task FinishAsync(string status)
    {
        if (_connection is null || _transaction is null)
        {
            throw new InvalidOperationException("No file is being processed.");
        }
        await _connection.ExecuteAsync("UPDATE files SET status = @status WHERE id = @fileId", new { status, fileId = _fileId }, _transaction);
        await _transaction.CommitAsync();
        await DisposeAsync();
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
