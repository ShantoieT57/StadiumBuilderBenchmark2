using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class CancelFileStepDefinitions(
    FileSeeder seeder,
    ApiScenarioState state,
    CancelClient canceller,
    SimulatedProcessing processing)
{
    /// <summary>How long a cancel must keep waiting to show that it is blocked, not merely slow.</summary>
    private static readonly TimeSpan BlockedFor = TimeSpan.FromMilliseconds(500);

    private Task<HttpResponseMessage>? _pendingCancel;

    [When("I cancel the file {string}")]
    public Task WhenICancelTheFile(string fileName) => canceller.CancelAsync(seeder.GetFileId(fileName));

    [When("I cancel the last uploaded file")]
    public Task WhenICancelTheLastUploadedFile() => canceller.CancelAsync(state.LastUploadedFileId);

    [When("I cancel a file that does not exist")]
    public Task WhenICancelAFileThatDoesNotExist() => canceller.CancelAsync(Guid.NewGuid());

    [Given("another importer {string} with the email {string} exists")]
    public Task GivenAnotherImporterExists(string name, string email) => TestDatabase.InsertImporterAsync(name, email);

    [Given("a file processor is processing the last uploaded file")]
    public Task GivenAFileProcessorIsProcessingTheLastUploadedFile() => processing.StartAsync(state.LastUploadedFileId);

    [When("I start cancelling the last uploaded file")]
    public void WhenIStartCancellingTheLastUploadedFile()
    {
        var fileId = state.LastUploadedFileId;
        _pendingCancel = Task.Run(() => canceller.SendCancelAsync(fileId));
    }

    [Then("the cancel is still waiting")]
    public async Task ThenTheCancelIsStillWaiting()
    {
        var pending = PendingCancel;
        var finished = await Task.WhenAny(pending, Task.Delay(BlockedFor));
        Assert.NotSame(pending, finished);
    }

    [When("the file processor finishes the last uploaded file as {string}")]
    public Task WhenTheFileProcessorFinishesTheLastUploadedFileAs(string status) => processing.FinishAsync(status);

    [Then("the cancel finishes with the response status code {int}")]
    public async Task ThenTheCancelFinishesWithTheResponseStatusCode(int statusCode)
    {
        await state.RecordResponseAsync(await PendingCancel.WaitAsync(TimeSpan.FromSeconds(15)));
        Assert.Equal(statusCode, (int)state.LastResponse.StatusCode);
    }

    [Then("the last uploaded file has no rows kept for corrections")]
    public async Task ThenTheLastUploadedFileHasNoRowsKeptForCorrections()
    {
        Assert.Empty(await TestDatabase.GetFileRowsAsync(state.LastUploadedFileId));
    }

    private Task<HttpResponseMessage> PendingCancel =>
        _pendingCancel ?? throw new InvalidOperationException("No cancel has been started in this scenario.");
}
