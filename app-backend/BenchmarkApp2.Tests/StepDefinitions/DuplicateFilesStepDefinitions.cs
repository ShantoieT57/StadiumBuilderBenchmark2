using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class DuplicateFilesStepDefinitions(ApiScenarioState state, ManualTimeProvider clock)
{
    [Given("uploaded file {int} has been cancelled")]
    public Task GivenUploadedFileHasBeenCancelled(int position) =>
        TestDatabase.CancelFileAsync(state.GetUploadedFileId(position), clock.GetUtcNow());
}
