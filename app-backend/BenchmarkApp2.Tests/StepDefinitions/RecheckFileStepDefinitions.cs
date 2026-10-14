using System.Net;
using System.Text.Json;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class RecheckFileStepDefinitions(
    TransactionApiFixture api,
    FileSeeder seeder,
    ApiScenarioState state,
    CorrectionClient corrections)
{
    private const string NotWaitingForCorrectionsMessage = "This file is not waiting for corrections.";

    private IReadOnlyList<HttpResponseMessage> _concurrentResponses = [];

    [When("I re-check the last uploaded file with the corrections:")]
    public async Task WhenIRecheckTheLastUploadedFileWithTheCorrections(DataTable rows)
    {
        var fileId = state.LastUploadedFileId;
        await corrections.RecheckAsync(fileId, await corrections.ToCorrectionsAsync(fileId, rows));
    }

    [When("I re-check the file {string} without corrections")]
    public Task WhenIRecheckTheFileWithoutCorrections(string fileName) => corrections.RecheckAsync(seeder.GetFileId(fileName), []);

    [When("I re-check a file that does not exist")]
    public Task WhenIRecheckAFileThatDoesNotExist() => corrections.RecheckAsync(Guid.NewGuid(), []);

    [When("I re-check the last uploaded file correcting its valid row {int}")]
    public Task WhenIRecheckCorrectingItsValidRow(int rowNumber) => RecheckCorrectingRowsAsync(state.LastUploadedFileId, rowNumber);

    [When("I re-check the last uploaded file correcting its invalid row {int} twice")]
    public Task WhenIRecheckCorrectingItsInvalidRowTwice(int rowNumber) =>
        RecheckCorrectingRowsAsync(state.LastUploadedFileId, rowNumber, rowNumber);

    /// <summary>The other file's only row is its invalid row 1.</summary>
    [When("I re-check the last uploaded file correcting the invalid row of uploaded file {int}")]
    public async Task WhenIRecheckCorrectingTheInvalidRowOfUploadedFile(int position)
    {
        var otherRowId = await corrections.GetRowIdAsync(state.GetUploadedFileId(position), 1);
        await corrections.RecheckAsync(state.LastUploadedFileId, [CorrectionClient.ValidCorrection(otherRowId)]);
    }

    [When("I re-check the last uploaded file correcting a row that does not exist")]
    public Task WhenIRecheckCorrectingARowThatDoesNotExist() =>
        corrections.RecheckAsync(state.LastUploadedFileId, [CorrectionClient.ValidCorrection(Guid.NewGuid())]);

    [When("I re-check the last uploaded file correcting row {int} without a currency")]
    public async Task WhenIRecheckCorrectingRowWithoutACurrency(int rowNumber)
    {
        var id = await corrections.GetRowIdAsync(state.LastUploadedFileId, rowNumber);
        await corrections.RecheckAsync(state.LastUploadedFileId,
        [
            new
            {
                id,
                reference = "TXN-1",
                transactionDate = "2026/04/15 08:12",
                accountNumber = "1001",
                description = "No currency",
                amount = "10",
                transactionType = "C",
            },
        ]);
    }

    /// <summary>Each <c>{row N}</c> in the body is replaced by the id of the file's row N.</summary>
    [When("I re-check the last uploaded file with the request body {string}")]
    public Task WhenIRecheckTheLastUploadedFileWithTheRequestBody(string body) =>
        corrections.RecheckWithBodyAsync(state.LastUploadedFileId, body);

    [When("I re-check the last uploaded file twice at the same time with the corrections:")]
    public async Task WhenIRecheckTheLastUploadedFileTwiceAtTheSameTime(DataTable rows)
    {
        var fileId = state.LastUploadedFileId;
        var body = await corrections.ToCorrectionsAsync(fileId, rows);
        _concurrentResponses = await Task.WhenAll(
            Task.Run(() => corrections.SendRecheckAsync(fileId, body)),
            Task.Run(() => corrections.SendRecheckAsync(fileId, body)));
    }

    [Given("my requests carry no session cookie")]
    public void GivenMyRequestsCarryNoSessionCookie()
    {
        state.SessionCookie = null;
    }

    [Given("I have noted the row ids of the last uploaded file")]
    public async Task GivenIHaveNotedTheRowIdsOfTheLastUploadedFile()
    {
        Assert.NotEmpty(await corrections.GetRowIdsAsync(state.LastUploadedFileId));
    }

    [Then("the re-check result status is {string}")]
    public void ThenTheRecheckResultStatusIs(string status)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        Assert.Equal(status, json.RootElement.GetProperty("status").GetString());
    }

    [Then("the rows that still fail are:")]
    public void ThenTheRowsThatStillFailAre(DataTable expected) => InvalidRowLists.AssertRows(expected, ReadRowsThatStillFail());

    [Then("the number of rows that still fail is {int}")]
    public void ThenTheNumberOfRowsThatStillFailIs(int count)
    {
        Assert.Equal(count, ReadRowsThatStillFail().TotalCount);
    }

    /// <summary>Compares the listed fields of the file in the result, named by their JSON path.</summary>
    [Then("the re-checked file details are:")]
    public void ThenTheRecheckedFileDetailsAre(DataTable expected)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        var file = json.RootElement.GetProperty("file");
        foreach (var row in expected.Rows)
        {
            JsonFields.AssertValue(row["field"], row["value"], JsonFields.Get(file, row["field"]));
        }
    }

    [Then("the processing history in the re-check result is:")]
    public void ThenTheProcessingHistoryInTheRecheckResultIs(DataTable expected)
    {
        Assert.Equal(HttpStatusCode.OK, state.LastResponse.StatusCode);
        using var json = JsonDocument.Parse(state.LastResponseBody);
        ProcessingHistoryAssert.AreStages(expected, json.RootElement.GetProperty("file").GetProperty("processingHistory"));
    }

    [Then("every row of the last uploaded file still has its noted id")]
    public async Task ThenEveryRowStillHasItsNotedId()
    {
        var noted = await corrections.GetRowIdsAsync(state.LastUploadedFileId);
        var current = (await TestDatabase.GetFileRowsAsync(state.LastUploadedFileId)).ToDictionary(row => row.RowNumber, row => row.Id);
        Assert.Equal(noted.OrderBy(pair => pair.Key), current.OrderBy(pair => pair.Key));
    }

    [Then("the rows that still fail have their noted ids")]
    public async Task ThenTheRowsThatStillFailHaveTheirNotedIds()
    {
        var noted = await corrections.GetRowIdsAsync(state.LastUploadedFileId);
        var rows = ReadRowsThatStillFail().Rows;
        Assert.NotEmpty(rows);
        Assert.All(rows, row => Assert.Equal(noted[row.RowNumber], row.Id));
    }

    [Then("downloading the last uploaded file still returns exactly the bytes that were uploaded")]
    public async Task ThenDownloadingStillReturnsTheUploadedBytes()
    {
        using var response = await api.SendAsync(HttpMethod.Get, $"files/{state.LastUploadedFileId}/content", sessionCookie: state.SessionCookie);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(state.LastUploadedFileContent, await response.Content.ReadAsByteArrayAsync());
    }

    [Then("one re-check completed the file and the other was refused because the file is not waiting for corrections")]
    public async Task ThenOneRecheckCompletedTheFileAndTheOtherWasRefused()
    {
        var completed = Assert.Single(_concurrentResponses, response => response.StatusCode == HttpStatusCode.OK);
        var refused = Assert.Single(_concurrentResponses, response => response.StatusCode == HttpStatusCode.Conflict);

        using var result = JsonDocument.Parse(await completed.Content.ReadAsStringAsync());
        Assert.Equal("Completed", result.RootElement.GetProperty("status").GetString());
        using var refusal = JsonDocument.Parse(await refused.Content.ReadAsStringAsync());
        Assert.Equal(NotWaitingForCorrectionsMessage, refusal.RootElement.GetProperty("message").GetString());
    }

    private async Task RecheckCorrectingRowsAsync(Guid fileId, params int[] rowNumbers)
    {
        var ids = await corrections.GetRowIdsAsync(fileId);
        await corrections.RecheckAsync(fileId, rowNumbers.Select(rowNumber => CorrectionClient.ValidCorrection(ids[rowNumber])));
    }

    private InvalidRowLists.InvalidRowListResponse ReadRowsThatStillFail()
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        return InvalidRowLists.Read(json.RootElement.GetProperty("invalidRows"));
    }
}
