using BenchmarkApp2.Data;

namespace BenchmarkApp2.Services.FileProcessor;

/// <summary>Runs the stages of processing a file and records each with the time it started and finished.</summary>
internal sealed class ProcessingHistory(FileProcessingUnit unit, TimeProvider timeProvider, CancellationToken cancellationToken)
{
    public async Task<T> RunAsync<T>(ProcessingStage stage, Func<Task<T>> work)
    {
        var startedAt = timeProvider.GetUtcNow();
        var result = await work();
        await unit.RecordStageAsync(stage, startedAt, timeProvider.GetUtcNow(), cancellationToken);
        return result;
    }

    public Task<T> RunAsync<T>(ProcessingStage stage, Func<T> work) => RunAsync(stage, () => Task.FromResult(work()));

    /// <summary>Records a stage that has started and is still under way.</summary>
    public Task StartAsync(ProcessingStage stage) =>
        unit.RecordStageAsync(stage, timeProvider.GetUtcNow(), finishedAt: null, cancellationToken);

    /// <summary>Finishes a stage that was recorded as still under way.</summary>
    public Task FinishAsync(ProcessingStage stage) =>
        unit.FinishStageAsync(stage, timeProvider.GetUtcNow(), cancellationToken);
}
