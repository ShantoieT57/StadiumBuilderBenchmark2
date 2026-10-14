using System.Net;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class SaveCorrectionsStepDefinitions(ApiScenarioState state, CorrectionClient corrections)
{
    [When("I save the corrections to the last uploaded file:")]
    public async Task WhenISaveTheCorrectionsToTheLastUploadedFile(DataTable rows)
    {
        var fileId = state.LastUploadedFileId;
        await corrections.SaveAsync(fileId, await corrections.ToCorrectionsAsync(fileId, rows));
    }

    [Given("I have saved the corrections to the last uploaded file:")]
    public async Task GivenIHaveSavedTheCorrectionsToTheLastUploadedFile(DataTable rows)
    {
        await WhenISaveTheCorrectionsToTheLastUploadedFile(rows);
        Assert.Equal(HttpStatusCode.OK, state.LastResponse.StatusCode);
    }

    [When("I save no corrections to the last uploaded file")]
    public Task WhenISaveNoCorrectionsToTheLastUploadedFile() => corrections.SaveAsync(state.LastUploadedFileId, []);

    [When("I save the corrections to a file that does not exist")]
    public Task WhenISaveTheCorrectionsToAFileThatDoesNotExist() =>
        corrections.SaveAsync(Guid.NewGuid(), [CorrectionClient.ValidCorrection(Guid.NewGuid())]);
}
