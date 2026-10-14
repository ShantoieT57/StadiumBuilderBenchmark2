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
        "Host=127.0.0.1;Port=5433;Database=benchmark_app_2_tests;Username=postgres;Password=postgres";

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
        await connection.ExecuteAsync("DELETE FROM transactions; DELETE FROM files; DELETE FROM sessions");
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

    /// <summary>A stored file's processing outcome.</summary>
    public static async Task<ProcessedFile> GetProcessedFileAsync(Guid fileId)
    {
        const string sql = """
            SELECT status, row_count AS RowCount, failure_kind AS FailureKind, failure_reason AS FailureReason,
                   loaded_count AS LoadedCount, skipped_existing_count AS SkippedExistingCount,
                   ignored_empty_reference_count AS IgnoredEmptyReferenceCount, last_processed_at AS LastProcessedAt
            FROM files
            WHERE id = @fileId
            """;
        await using var connection = new NpgsqlConnection(ConnectionString);
        return await connection.QuerySingleAsync<ProcessedFile>(sql, new { fileId });
    }

    /// <summary>Puts a file into a status directly, as if a processor had been interrupted.</summary>
    public static async Task SetFileStatusAsync(Guid fileId, string status)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        Assert.Equal(1, await connection.ExecuteAsync("UPDATE files SET status = @status WHERE id = @fileId", new { fileId, status }));
    }

    /// <summary>
    /// Marks a file cancelled and removes its transactions (FX-03), standing in for the cancel action
    /// until it exists.
    /// </summary>
    public static async Task CancelFileAsync(Guid fileId, DateTimeOffset now)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.ExecuteAsync("DELETE FROM transactions WHERE file_id = @fileId", new { fileId });
        Assert.Equal(1, await connection.ExecuteAsync("UPDATE files SET cancelled_at = @now WHERE id = @fileId", new { fileId, now }));
    }

    /// <summary>
    /// Stores a file directly in the state it would have after processing, uploaded by the seeded
    /// importer, and returns its id. Files are received in the order they are inserted.
    /// </summary>
    public static async Task<Guid> InsertFileAsync(SeedFile file, DateTimeOffset now)
    {
        const string sql = """
            INSERT INTO files (file_name, kind, status, content, content_sha256, uploaded_by, uploaded_at,
                               row_count, failure_kind, failure_reason, last_processed_at, cancelled_at)
            SELECT @FileName, 'BankTransactions', @Status, @Content, sha256(@Content), id, @UploadedAt,
                   @RowCount, @FailureKind, @FailureReason, @LastProcessedAt, @CancelledAt
            FROM users
            WHERE email = 'fileimporter@digiata.com'
            RETURNING id
            """;
        await using var connection = new NpgsqlConnection(ConnectionString);
        return await connection.QuerySingleAsync<Guid>(sql, new
        {
            file.FileName,
            file.Status,
            Content = Guid.NewGuid().ToByteArray(),
            UploadedAt = now,
            file.RowCount,
            file.FailureKind,
            file.FailureReason,
            file.LastProcessedAt,
            CancelledAt = file.IsCancelled ? now : (DateTimeOffset?)null,
        });
    }

    /// <summary>Stores a number of transactions with one status for a file, with unique references.</summary>
    public static async Task InsertTransactionsAsync(Guid fileId, string status, int count, DateTimeOffset now)
    {
        const string sql = """
            INSERT INTO transactions (file_id, reference, transaction_date, account_number, description, amount,
                                      transaction_type, currency, status, created_by, created_at, last_changed_by, last_changed_at)
            SELECT @fileId, @fileId::text || '-' || @status || '-' || n, '2026-04-15 08:00:00', '1234567890', 'Seeded',
                   10.00, 'Credit', 'ZAR', @status, 'System', @now, 'System', @now
            FROM generate_series(1, @count) AS n
            """;
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.ExecuteAsync(sql, new { fileId, status, count, now });
    }

    /// <summary>Every loaded transaction, or only those loaded from one file.</summary>
    public static async Task<IReadOnlyList<StoredTransaction>> GetTransactionsAsync(Guid? fileId = null)
    {
        const string sql = """
            SELECT id, file_id AS FileId, reference, transaction_date AS TransactionDate, account_number AS AccountNumber,
                   description, amount, transaction_type AS TransactionType, currency, status,
                   created_by AS CreatedBy, created_at AS CreatedAt, last_changed_by AS LastChangedBy, last_changed_at AS LastChangedAt
            FROM transactions
            WHERE @fileId IS NULL OR file_id = @fileId
            ORDER BY reference
            """;
        await using var connection = new NpgsqlConnection(ConnectionString);
        return (await connection.QueryAsync<StoredTransaction>(sql, new { fileId })).ToList();
    }

    /// <summary>A file's processing history, in the order the stages ran.</summary>
    public static async Task<IReadOnlyList<StoredProcessingStage>> GetProcessingStagesAsync(Guid fileId)
    {
        const string sql = """
            SELECT stage, started_at AS StartedAt, finished_at AS FinishedAt
            FROM file_processing_stages
            WHERE file_id = @fileId
            ORDER BY id
            """;
        await using var connection = new NpgsqlConnection(ConnectionString);
        return (await connection.QueryAsync<StoredProcessingStage>(sql, new { fileId })).ToList();
    }

    /// <summary>The rows kept for a file waiting for corrections, in file order.</summary>
    public static async Task<IReadOnlyList<StoredFileRow>> GetFileRowsAsync(Guid fileId)
    {
        const string sql = """
            SELECT row_number AS RowNumber, reference, transaction_date AS TransactionDate, account_number AS AccountNumber,
                   description, amount, transaction_type AS TransactionType, currency,
                   column_count AS ColumnCount, extra_values AS ExtraValues, reasons
            FROM file_rows
            WHERE file_id = @fileId
            ORDER BY row_number
            """;
        await using var connection = new NpgsqlConnection(ConnectionString);
        return (await connection.QueryAsync<StoredFileRow>(sql, new { fileId })).ToList();
    }
}

/// <summary>A file stored directly by a scenario, in the state it would have after processing.</summary>
public sealed record SeedFile(
    string FileName,
    string Status,
    string? FailureKind,
    string? FailureReason,
    DateTimeOffset? LastProcessedAt,
    int? RowCount,
    bool IsCancelled);

public sealed class ProcessedFile
{
    public string Status { get; init; } = string.Empty;
    public int? RowCount { get; init; }
    public string? FailureKind { get; init; }
    public string? FailureReason { get; init; }
    public int? LoadedCount { get; init; }
    public int? SkippedExistingCount { get; init; }
    public int? IgnoredEmptyReferenceCount { get; init; }
    public DateTime? LastProcessedAt { get; init; }
}

public sealed class StoredTransaction
{
    public Guid Id { get; init; }
    public Guid FileId { get; init; }
    public string Reference { get; init; } = string.Empty;
    public DateTime TransactionDate { get; init; }
    public string AccountNumber { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public decimal Amount { get; init; }
    public string TransactionType { get; init; } = string.Empty;
    public string Currency { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public string CreatedBy { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public string LastChangedBy { get; init; } = string.Empty;
    public DateTime LastChangedAt { get; init; }
}

public sealed class StoredProcessingStage
{
    public string Stage { get; init; } = string.Empty;
    public DateTime StartedAt { get; init; }
    public DateTime? FinishedAt { get; init; }
}

public sealed class StoredFileRow
{
    public int RowNumber { get; init; }
    public string Reference { get; init; } = string.Empty;
    public string TransactionDate { get; init; } = string.Empty;
    public string AccountNumber { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string Amount { get; init; } = string.Empty;
    public string TransactionType { get; init; } = string.Empty;
    public string Currency { get; init; } = string.Empty;
    public int ColumnCount { get; init; }
    public string[] ExtraValues { get; init; } = [];
    public string[] Reasons { get; init; } = [];
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
