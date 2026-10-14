using Dapper;
using Npgsql;

namespace BenchmarkApp2.Data;

/// <summary>
/// Database access for claiming files to process. A file is claimed by moving it from Uploaded to
/// Processing in its own short transaction, so the status is visible straight away; the claimed file
/// is then processed inside a <see cref="FileProcessingUnit"/>.
/// </summary>
public sealed class FileProcessingRepository(NpgsqlDataSource dataSource)
{
    /// <summary>
    /// Claims the earliest received uploaded file that is not cancelled by moving it to Processing, and returns
    /// its id, or null when no file is waiting. <c>SKIP LOCKED</c> means processors running at the
    /// same time each claim a different file and never wait on each other.
    /// </summary>
    public async Task<Guid?> ClaimNextUploadedFileAsync(CancellationToken cancellationToken)
    {
        const string sql = $"""
            UPDATE files
            SET status = '{FileStatusValue.Processing}'
            WHERE id = (
                SELECT id FROM files
                WHERE status = '{FileStatusValue.Uploaded}' AND cancelled_at IS NULL
                ORDER BY received_order
                LIMIT 1
                FOR UPDATE SKIP LOCKED)
            RETURNING id
            """;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<Guid?>(new CommandDefinition(sql, cancellationToken: cancellationToken));
    }

    /// <summary>
    /// Returns files left in Processing by an interrupted processor to Uploaded so they are processed
    /// again, and returns how many there were. A file that a live processor is working on is locked
    /// by its <see cref="FileProcessingUnit"/> and is skipped.
    /// </summary>
    public async Task<int> RecoverInterruptedFilesAsync(CancellationToken cancellationToken)
    {
        const string sql = $"""
            UPDATE files
            SET status = '{FileStatusValue.Uploaded}'
            WHERE id IN (
                SELECT id FROM files
                WHERE status = '{FileStatusValue.Processing}'
                FOR UPDATE SKIP LOCKED)
            """;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.ExecuteAsync(new CommandDefinition(sql, cancellationToken: cancellationToken));
    }

    /// <summary>Returns a claimed file whose processing did not finish to Uploaded, so it is tried again later.</summary>
    public async Task ReturnToUploadedAsync(Guid fileId, CancellationToken cancellationToken)
    {
        const string sql = $"""
            UPDATE files
            SET status = '{FileStatusValue.Uploaded}'
            WHERE id = @fileId AND status = '{FileStatusValue.Processing}'
            """;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(sql, new { fileId }, cancellationToken: cancellationToken));
    }

    /// <summary>
    /// Starts processing a claimed file in one transaction and returns it, or null when the file is no
    /// longer in Processing (for example, recovered by another instance in the meantime).
    /// </summary>
    public async Task<FileProcessingUnit?> BeginProcessingAsync(Guid fileId, CancellationToken cancellationToken) =>
        await FileProcessingUnit.BeginAsync(dataSource, fileId, cancellationToken);
}
