using System.Text.Json;
using Dapper;
using Npgsql;

namespace BenchmarkApp2.Data;

/// <summary>
/// The database work of processing one claimed file, done in a single transaction so that a crash
/// or error never leaves a partial load, half-kept rows or a partial processing history. The file
/// row is locked (<c>FOR NO KEY UPDATE</c>) until the unit is committed or disposed, which keeps
/// recovery from taking the file away from a live processor. Disposing without committing rolls
/// everything back.
/// </summary>
public sealed class FileProcessingUnit : IAsyncDisposable
{
    private readonly NpgsqlConnection _connection;
    private readonly NpgsqlTransaction _transaction;

    private FileProcessingUnit(NpgsqlConnection connection, NpgsqlTransaction transaction, FileToProcess file)
    {
        _connection = connection;
        _transaction = transaction;
        File = file;
    }

    public FileToProcess File { get; }

    internal static async Task<FileProcessingUnit?> BeginAsync(NpgsqlDataSource dataSource, Guid fileId, CancellationToken cancellationToken)
    {
        const string sql = $"""
            SELECT id, file_name AS FileName, content
            FROM files
            WHERE id = @fileId AND status = '{FileStatusValue.Processing}'
            FOR NO KEY UPDATE
            """;
        var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        NpgsqlTransaction? transaction = null;
        try
        {
            transaction = await connection.BeginTransactionAsync(cancellationToken);
            var file = await connection.QuerySingleOrDefaultAsync<FileToProcess>(
                new CommandDefinition(sql, new { fileId }, transaction, cancellationToken: cancellationToken));
            if (file is not null)
            {
                return new FileProcessingUnit(connection, transaction, file);
            }
        }
        catch
        {
            await DisposeAsync(connection, transaction);
            throw;
        }

        await DisposeAsync(connection, transaction);
        return null;
    }

    public Task SetRowCountAsync(int rowCount, CancellationToken cancellationToken) =>
        ExecuteAsync("UPDATE files SET row_count = @rowCount WHERE id = @FileId", new { rowCount, FileId = File.Id }, cancellationToken);

    /// <summary>
    /// The name of the earliest file received before this one with exactly the same content that
    /// still counts for the duplicate check (FP-01), or null when there is none. Cancelled files and
    /// files that failed as duplicates do not count; files failed for invalid rows do.
    /// </summary>
    public Task<string?> FindDuplicateSourceAsync(CancellationToken cancellationToken)
    {
        const string sql = $"""
            SELECT earlier.file_name
            FROM files AS this
            JOIN files AS earlier
                ON earlier.content_sha256 = this.content_sha256
               AND earlier.content = this.content
               AND earlier.received_order < this.received_order
            WHERE this.id = @FileId
              AND earlier.cancelled_at IS NULL
              AND (earlier.status IN ('{FileStatusValue.Uploaded}', '{FileStatusValue.Processing}', '{FileStatusValue.Completed}')
                   OR earlier.failure_kind = '{nameof(FileFailureKind.InvalidRows)}')
            ORDER BY earlier.received_order
            LIMIT 1
            """;
        return _connection.QuerySingleOrDefaultAsync<string?>(
            new CommandDefinition(sql, new { FileId = File.Id }, _transaction, cancellationToken: cancellationToken));
    }

    /// <summary>Records a stage in the file's processing history. A stage still under way has no finish time.</summary>
    public Task RecordStageAsync(ProcessingStage stage, DateTimeOffset startedAt, DateTimeOffset? finishedAt, CancellationToken cancellationToken)
    {
        const string sql = """
            INSERT INTO file_processing_stages (file_id, stage, started_at, finished_at)
            VALUES (@FileId, @Stage, @startedAt, @finishedAt)
            """;
        return ExecuteAsync(sql, new { FileId = File.Id, Stage = stage.ToString(), startedAt, finishedAt }, cancellationToken);
    }

    /// <summary>
    /// Keeps every row of the file with its original values and reasons, replacing any rows kept
    /// before. The array columns are passed as JSON because rows of arrays cannot be unnested.
    /// </summary>
    public async Task SaveRowsAsync(IReadOnlyList<FileRowRecord> rows, CancellationToken cancellationToken)
    {
        const string sql = """
            INSERT INTO file_rows (file_id, row_number, reference, transaction_date, account_number, description,
                                   amount, transaction_type, currency, column_count, extra_values, reasons)
            SELECT @FileId, r.row_number, r.reference, r.transaction_date, r.account_number, r.description,
                   r.amount, r.transaction_type, r.currency, r.column_count,
                   ARRAY(SELECT jsonb_array_elements_text(r.extra_values::jsonb)),
                   ARRAY(SELECT jsonb_array_elements_text(r.reasons::jsonb))
            FROM unnest(@RowNumbers, @References, @TransactionDates, @AccountNumbers, @Descriptions,
                        @Amounts, @TransactionTypes, @Currencies, @ColumnCounts, @ExtraValues, @Reasons)
                AS r(row_number, reference, transaction_date, account_number, description,
                     amount, transaction_type, currency, column_count, extra_values, reasons)
            """;
        await ExecuteAsync("DELETE FROM file_rows WHERE file_id = @FileId", new { FileId = File.Id }, cancellationToken);
        await ExecuteAsync(sql, new
        {
            FileId = File.Id,
            RowNumbers = rows.Select(row => row.Values.RowNumber).ToArray(),
            References = rows.Select(row => row.Values.Reference).ToArray(),
            TransactionDates = rows.Select(row => row.Values.TransactionDate).ToArray(),
            AccountNumbers = rows.Select(row => row.Values.AccountNumber).ToArray(),
            Descriptions = rows.Select(row => row.Values.Description).ToArray(),
            Amounts = rows.Select(row => row.Values.Amount).ToArray(),
            TransactionTypes = rows.Select(row => row.Values.TransactionType).ToArray(),
            Currencies = rows.Select(row => row.Values.Currency).ToArray(),
            ColumnCounts = rows.Select(row => row.Values.ColumnCount).ToArray(),
            ExtraValues = rows.Select(row => JsonSerializer.Serialize(row.Values.ExtraValues)).ToArray(),
            Reasons = rows.Select(row => JsonSerializer.Serialize(row.Reasons)).ToArray(),
        }, cancellationToken);
    }

    /// <summary>
    /// Loads the transactions with the status Imported and returns how many were inserted. A row
    /// whose reference already exists, ignoring upper and lower case, is skipped and the existing
    /// transaction is left unchanged (FP-05). The unique index on <c>lower(reference)</c> enforces
    /// this even when another file is loading the same reference at the same time: the later insert
    /// waits for the earlier transaction and then skips the row if it committed. Rows are inserted
    /// in reference order so two concurrent loads lock references in the same order.
    /// </summary>
    public async Task<int> InsertTransactionsAsync(IReadOnlyList<NewTransactionRecord> transactions, string changedBy, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (transactions.Count == 0)
        {
            return 0;
        }

        const string sql = """
            INSERT INTO transactions (file_id, reference, transaction_date, account_number, description, amount,
                                      transaction_type, currency, status, created_by, created_at, last_changed_by, last_changed_at)
            SELECT @FileId, t.reference, t.transaction_date, t.account_number, t.description, t.amount,
                   t.transaction_type, t.currency, 'Imported', @changedBy, @now, @changedBy, @now
            FROM unnest(@References, @TransactionDates, @AccountNumbers, @Descriptions, @Amounts, @TransactionTypes, @Currencies)
                AS t(reference, transaction_date, account_number, description, amount, transaction_type, currency)
            ORDER BY lower(t.reference)
            ON CONFLICT ((lower(reference))) DO NOTHING
            """;
        return await ExecuteAsync(sql, new
        {
            FileId = File.Id,
            changedBy,
            now,
            References = transactions.Select(t => t.Reference).ToArray(),
            TransactionDates = transactions.Select(t => t.TransactionDate).ToArray(),
            AccountNumbers = transactions.Select(t => t.AccountNumber).ToArray(),
            Descriptions = transactions.Select(t => t.Description).ToArray(),
            Amounts = transactions.Select(t => t.Amount).ToArray(),
            TransactionTypes = transactions.Select(t => t.TransactionType).ToArray(),
            Currencies = transactions.Select(t => t.Currency).ToArray(),
        }, cancellationToken);
    }

    public Task MarkCompletedAsync(FileLoadCounts counts, DateTimeOffset now, CancellationToken cancellationToken)
    {
        const string sql = $"""
            UPDATE files
            SET status = '{FileStatusValue.Completed}', failure_kind = NULL, failure_reason = NULL,
                loaded_count = @Loaded, skipped_existing_count = @SkippedExisting,
                ignored_empty_reference_count = @IgnoredEmptyReference, last_processed_at = @now
            WHERE id = @FileId
            """;
        return ExecuteAsync(sql, new { FileId = File.Id, counts.Loaded, counts.SkippedExisting, counts.IgnoredEmptyReference, now }, cancellationToken);
    }

    public Task MarkFailedAsync(FileFailureKind failureKind, string failureReason, DateTimeOffset now, CancellationToken cancellationToken)
    {
        const string sql = $"""
            UPDATE files
            SET status = '{FileStatusValue.Failed}', failure_kind = @FailureKind, failure_reason = @failureReason,
                last_processed_at = @now
            WHERE id = @FileId
            """;
        return ExecuteAsync(sql, new { FileId = File.Id, FailureKind = failureKind.ToString(), failureReason, now }, cancellationToken);
    }

    public Task CommitAsync(CancellationToken cancellationToken) => _transaction.CommitAsync(cancellationToken);

    public ValueTask DisposeAsync() => DisposeAsync(_connection, _transaction);

    private Task<int> ExecuteAsync(string sql, object parameters, CancellationToken cancellationToken) =>
        _connection.ExecuteAsync(new CommandDefinition(sql, parameters, _transaction, cancellationToken: cancellationToken));

    private static async ValueTask DisposeAsync(NpgsqlConnection connection, NpgsqlTransaction? transaction)
    {
        if (transaction is not null)
        {
            await transaction.DisposeAsync();
        }
        await connection.DisposeAsync();
    }
}
