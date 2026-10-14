using BenchmarkApp2.Data;

namespace BenchmarkApp2.Services.FileProcessor;

/// <summary>
/// The outcome of stages 4 to 7: how many rows are invalid when the file waits for corrections, or
/// how its rows were loaded when it is Completed.
/// </summary>
public sealed record CheckAndLoadOutcome(int InvalidRowCount, FileLoadCounts? Counts)
{
    public bool IsCompleted => Counts is not null;
}

/// <summary>
/// Stages 4 (Convert types), 5 (Check rows), 6 (Wait for corrections) and 7 (Load) over every row
/// of a file. Used both when a file is first processed and when a corrected file is checked again
/// (FC-03), within the caller's <see cref="FileProcessingUnit"/>. If any row is invalid, the file
/// waits for corrections with every row kept and nothing loaded (FP-06); otherwise the rows with a
/// reference are loaded, the kept rows are no longer needed and the file is Completed.
/// </summary>
internal sealed class CheckAndLoadStages(TimeProvider timeProvider, ILogger logger)
{
    /// <summary>Who loaded transactions are created and last changed by (FP-08).</summary>
    public const string SystemUser = "System";

    public async Task<CheckAndLoadOutcome> RunAsync(
        FileProcessingUnit unit, ProcessingHistory history, IReadOnlyList<FileRowValues> rows, CancellationToken cancellationToken)
    {
        var converted = await history.RunAsync(ProcessingStage.ConvertTypes, () => RowChecker.Convert(rows));
        var checkedRows = await history.RunAsync(ProcessingStage.CheckRows, () => RowChecker.Check(converted));

        var invalidRowCount = checkedRows.Count(row => row.IsInvalid);
        if (invalidRowCount > 0)
        {
            await history.StartAsync(ProcessingStage.WaitForCorrections);
            await unit.SaveRowsAsync(checkedRows.Select(row => row.ToRecord()).ToList(), cancellationToken);
            await unit.MarkFailedAsync(FileFailureKind.InvalidRows, DescribeInvalidRows(invalidRowCount), timeProvider.GetUtcNow(), cancellationToken);
            logger.LogInformation("File {FileId} has {InvalidRowCount} invalid row(s) and waits for corrections.", unit.FileId, invalidRowCount);
            return new CheckAndLoadOutcome(invalidRowCount, Counts: null);
        }

        var toLoad = checkedRows.Where(row => !row.IsIgnored).Select(row => row.ToTransaction()).ToList();
        var loaded = await history.RunAsync(ProcessingStage.Load, () =>
            unit.InsertTransactionsAsync(toLoad, SystemUser, timeProvider.GetUtcNow(), cancellationToken));

        var counts = new FileLoadCounts(loaded, toLoad.Count - loaded, checkedRows.Count - toLoad.Count);
        await unit.DiscardRowsAsync(cancellationToken);
        await unit.MarkCompletedAsync(counts, timeProvider.GetUtcNow(), cancellationToken);
        logger.LogInformation("File {FileId} completed: {Loaded} loaded, {SkippedExisting} skipped as existing, {IgnoredEmptyReference} ignored.",
            unit.FileId, counts.Loaded, counts.SkippedExisting, counts.IgnoredEmptyReference);
        return new CheckAndLoadOutcome(InvalidRowCount: 0, counts);
    }

    private static string DescribeInvalidRows(int count) => count == 1 ? "File has 1 invalid row" : $"File has {count} invalid rows";
}
