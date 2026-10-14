using Reqnroll;

namespace BenchmarkApp2.Tests.Support;

[Binding]
public sealed class Hooks
{
    [BeforeTestRun]
    public static Task RecreateDatabaseAsync() => TestDatabase.RecreateAsync();

    [BeforeScenario]
    public static Task ResetDatabaseAsync() => TestDatabase.ResetAsync();

    /// <summary>
    /// Stops the scenario's hosts and background services and releases their database connections
    /// explicitly, so nothing a scenario started keeps running into the next scenario.
    /// </summary>
    [AfterScenario]
    public static async Task StopHostsAsync(
        TransactionApiFixture api,
        FileProcessorFixture fileProcessor,
        SimulatedProcessing processing,
        HeldDatabaseLock heldLock,
        ApplicationFixture application,
        EventStreams eventStreams)
    {
        await eventStreams.DisposeAsync();
        await application.DisposeAsync();
        await heldLock.DisposeAsync();
        await processing.DisposeAsync();
        await fileProcessor.DisposeAsync();
        await api.DisposeAsync();
    }
}
