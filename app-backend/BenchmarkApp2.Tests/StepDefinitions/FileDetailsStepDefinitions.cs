using System.Text.Json;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class FileDetailsStepDefinitions(TransactionApiFixture api, FileSeeder seeder, ApiScenarioState state)
{
    [When("I request the details of the last uploaded file")]
    public Task WhenIRequestTheDetailsOfTheLastUploadedFile() => RequestDetailsAsync(state.LastUploadedFileId);

    [When("I request the details of the file {string}")]
    public Task WhenIRequestTheDetailsOfTheFile(string fileName) => RequestDetailsAsync(seeder.GetFileId(fileName));

    [When("I request the details of a file that does not exist")]
    public Task WhenIRequestTheDetailsOfAFileThatDoesNotExist() => RequestDetailsAsync(Guid.NewGuid());

    /// <summary>
    /// Compares the listed fields of the response, named by their JSON path (e.g.
    /// <c>transactions.imported</c>). An empty value means null; a field ending in "At" is compared as
    /// a point in time.
    /// </summary>
    [Then("the file details are:")]
    public void ThenTheFileDetailsAre(DataTable expected)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        foreach (var row in expected.Rows)
        {
            var field = row["field"];
            var actual = JsonFields.Get(json.RootElement, field);
            JsonFields.AssertValue(field, row["value"], actual);
        }
    }

    [Then("the details are for the last uploaded file")]
    public void ThenTheDetailsAreForTheLastUploadedFile()
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        Assert.Equal(state.LastUploadedFileId, json.RootElement.GetProperty("id").GetGuid());
    }

    [Then("the processing history in the details is:")]
    public void ThenTheProcessingHistoryInTheDetailsIs(DataTable expected)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        ProcessingHistoryAssert.AreStages(expected, json.RootElement.GetProperty("processingHistory"));
    }

    [Then("the processing history in the details lists the stages {string}")]
    public void ThenTheProcessingHistoryInTheDetailsListsTheStages(string stages)
    {
        Assert.Equal(
            stages.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries),
            ReadHistory().Select(stage => stage.GetProperty("stage").GetString()));
    }

    private List<JsonElement> ReadHistory()
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        return json.RootElement.GetProperty("processingHistory").EnumerateArray().Select(stage => stage.Clone()).ToList();
    }

    private async Task RequestDetailsAsync(Guid fileId)
    {
        await state.RecordResponseAsync(await api.SendAsync(HttpMethod.Get, $"files/{fileId}", sessionCookie: state.SessionCookie));
    }
}
