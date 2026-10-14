using BenchmarkApp2.Data;

namespace BenchmarkApp2.Services.FileProcessor;

/// <summary>
/// Processes uploaded files through the stages Receive, Duplicate check, Read rows, Convert types,
/// Check rows, Wait for corrections and Load, recording each stage in the file's processing history.
/// A file moves from Uploaded to Processing when it is claimed, and to Completed or Failed when its
/// processing is committed. All of a file's processing is one database transaction, so nothing is
/// loaded unless the whole file is.
/// </summary>
public sealed class Processor(FileProcessingRepository repository, TimeProvider timeProvider, ILogger<Processor> logger)
{
    private readonly CheckAndLoadStages _checkAndLoad = new(timeProvider, logger);

    /// <summary>
    /// Returns files left in Processing by an interrupted processor to Uploaded, so they are
    /// processed again.
    /// </summary>
    public async Task RecoverInterruptedFilesAsync(CancellationToken cancellationToken)
    {
        var recovered = await repository.RecoverInterruptedFilesAsync(cancellationToken);
        if (recovered > 0)
        {
            logger.LogWarning("Returned {FileCount} interrupted file(s) from Processing to Uploaded.", recovered);
        }
    }

    /// <summary>
    /// Claims and processes waiting files, oldest first, until none is left. If a file cannot be
    /// processed because of an unexpected error, it is returned to Uploaded and this run stops, so
    /// the file is tried again on the next run rather than straight away.
    /// </summary>
    public async Task ProcessWaitingFilesAsync(CancellationToken cancellationToken)
    {
        while (await repository.ClaimNextUploadedFileAsync(cancellationToken) is { } fileId)
        {
            try
            {
                await ProcessAsync(fileId, cancellationToken);
            }
            catch (Exception exception)
            {
                await repository.ReturnToUploadedAsync(fileId, CancellationToken.None);
                if (exception is OperationCanceledException && cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                logger.LogError(exception, "Processing file {FileId} failed; it will be tried again later.", fileId);
                return;
            }
        }
    }

    private async Task ProcessAsync(Guid fileId, CancellationToken cancellationToken)
    {
        if (await repository.BeginProcessingAsync(fileId, cancellationToken) is not { } started)
        {
            return;
        }
        await using var unit = started.Unit;
        var history = new ProcessingHistory(unit, timeProvider, cancellationToken);

        var records = await history.RunAsync(ProcessingStage.Receive, async () =>
        {
            var fileRecords = TransactionFileReader.ReadRecords(started.File.Content);
            await unit.SetRowCountAsync(fileRecords.Count, cancellationToken);
            return fileRecords;
        });

        // A file with no transaction rows is never a duplicate (FP-01).
        var duplicateOf = await history.RunAsync(ProcessingStage.DuplicateCheck, () =>
            records.Count == 0 ? Task.FromResult<string?>(null) : unit.FindDuplicateSourceAsync(cancellationToken));
        if (duplicateOf is not null)
        {
            await unit.MarkFailedAsync(FileFailureKind.Duplicate, $"File is a duplicate of another file {duplicateOf}", timeProvider.GetUtcNow(), cancellationToken);
            await unit.CommitAsync(cancellationToken);
            logger.LogInformation("File {FileId} failed as a duplicate of {DuplicateOf}.", fileId, duplicateOf);
            return;
        }

        var rows = await history.RunAsync(ProcessingStage.ReadRows, () => TransactionFileReader.ReadRows(records));
        await _checkAndLoad.RunAsync(unit, history, rows, cancellationToken);
        await unit.CommitAsync(cancellationToken);
    }
}
