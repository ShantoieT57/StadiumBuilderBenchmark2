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
    /// <summary>Who loaded transactions are created and last changed by (FP-08).</summary>
    public const string SystemUser = "System";

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
        await using var unit = await repository.BeginProcessingAsync(fileId, cancellationToken);
        if (unit is null)
        {
            return;
        }
        var history = new ProcessingHistory(unit, timeProvider, cancellationToken);

        var records = await history.RunAsync(ProcessingStage.Receive, async () =>
        {
            var fileRecords = TransactionFileReader.ReadRecords(unit.File.Content);
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
        await CheckAndLoadAsync(unit, history, rows, cancellationToken);
        await unit.CommitAsync(cancellationToken);
    }

    /// <summary>
    /// Stages 4 to 7 over a file's rows. If any row is invalid, the file waits for corrections with
    /// every row kept and nothing loaded (FP-06); otherwise the valid rows are loaded and the file is
    /// Completed.
    /// </summary>
    private async Task CheckAndLoadAsync(FileProcessingUnit unit, ProcessingHistory history, IReadOnlyList<FileRowValues> rows, CancellationToken cancellationToken)
    {
        var converted = await history.RunAsync(ProcessingStage.ConvertTypes, () => RowChecker.Convert(rows));
        var checkedRows = await history.RunAsync(ProcessingStage.CheckRows, () => RowChecker.Check(converted));

        var invalidRowCount = checkedRows.Count(row => row.IsInvalid);
        if (invalidRowCount > 0)
        {
            await history.StartAsync(ProcessingStage.WaitForCorrections);
            await unit.SaveRowsAsync(checkedRows.Select(row => row.ToRecord()).ToList(), cancellationToken);
            await unit.MarkFailedAsync(FileFailureKind.InvalidRows, DescribeInvalidRows(invalidRowCount), timeProvider.GetUtcNow(), cancellationToken);
            logger.LogInformation("File {FileId} has {InvalidRowCount} invalid row(s) and waits for corrections.", unit.File.Id, invalidRowCount);
            return;
        }

        var toLoad = checkedRows.Where(row => !row.IsIgnored).Select(row => row.ToTransaction()).ToList();
        var loaded = await history.RunAsync(ProcessingStage.Load, () =>
            unit.InsertTransactionsAsync(toLoad, SystemUser, timeProvider.GetUtcNow(), cancellationToken));

        var counts = new FileLoadCounts(loaded, toLoad.Count - loaded, checkedRows.Count - toLoad.Count);
        await unit.MarkCompletedAsync(counts, timeProvider.GetUtcNow(), cancellationToken);
        logger.LogInformation("File {FileId} completed: {Loaded} loaded, {SkippedExisting} skipped as existing, {IgnoredEmptyReference} ignored.",
            unit.File.Id, counts.Loaded, counts.SkippedExisting, counts.IgnoredEmptyReference);
    }

    private static string DescribeInvalidRows(int count) => count == 1 ? "File has 1 invalid row" : $"File has {count} invalid rows";
}
