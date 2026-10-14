using System.Text.Json;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class InvalidRowsStepDefinitions(TransactionApiFixture api, FileSeeder seeder, ApiScenarioState state)
{
    private IReadOnlyList<Guid> _previousRowIds = [];

    [When("I request the invalid rows of the last uploaded file")]
    public Task WhenIRequestTheInvalidRowsOfTheLastUploadedFile() => RequestInvalidRowsAsync(state.LastUploadedFileId);

    [When("I request the invalid rows of the last uploaded file again")]
    public Task WhenIRequestTheInvalidRowsOfTheLastUploadedFileAgain()
    {
        _previousRowIds = ReadList().Rows.Select(row => row.Id).ToList();
        return RequestInvalidRowsAsync(state.LastUploadedFileId);
    }

    [When("I request the invalid rows of the file {string}")]
    public Task WhenIRequestTheInvalidRowsOfTheFile(string fileName) => RequestInvalidRowsAsync(seeder.GetFileId(fileName));

    [When("I request the invalid rows of a file that does not exist")]
    public Task WhenIRequestTheInvalidRowsOfAFileThatDoesNotExist() => RequestInvalidRowsAsync(Guid.NewGuid());

    [Then("the invalid rows are:")]
    public void ThenTheInvalidRowsAre(DataTable expected) => InvalidRowLists.AssertRows(expected, ReadList());

    [Then("the number of invalid rows remaining is {int}")]
    public void ThenTheNumberOfInvalidRowsRemainingIs(int count)
    {
        Assert.Equal(count, ReadList().TotalCount);
    }

    [Then("every invalid row has a different id")]
    public void ThenEveryInvalidRowHasADifferentId()
    {
        var ids = ReadList().Rows.Select(row => row.Id).ToList();
        Assert.DoesNotContain(Guid.Empty, ids);
        Assert.Equal(ids.Count, ids.Distinct().Count());
    }

    [Then("the invalid rows have the same ids as before")]
    public void ThenTheInvalidRowsHaveTheSameIdsAsBefore()
    {
        Assert.NotEmpty(_previousRowIds);
        Assert.Equal(_previousRowIds, ReadList().Rows.Select(row => row.Id));
    }

    private async Task RequestInvalidRowsAsync(Guid fileId)
    {
        await state.RecordResponseAsync(await api.SendAsync(HttpMethod.Get, $"files/{fileId}/invalid-rows", sessionCookie: state.SessionCookie));
    }

    private InvalidRowLists.InvalidRowListResponse ReadList()
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        return InvalidRowLists.Read(json.RootElement);
    }
}
