using System.Globalization;
using System.Text.Json;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class InvalidRowsStepDefinitions(TransactionApiFixture api, FileSeeder seeder, ApiScenarioState state)
{
    private const string ReasonSeparator = "; ";

    /// <summary>Reads the response exactly as sent: camelCase names, matched case-sensitively.</summary>
    private static readonly JsonSerializerOptions ResponseJson = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

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

    /// <summary>
    /// Table cells lose their surrounding spaces, so a value that must keep them is written between
    /// single quotes.
    /// </summary>
    [Then("the invalid rows are:")]
    public void ThenTheInvalidRowsAre(DataTable expected)
    {
        var rows = ReadList().Rows;
        Assert.Equal(expected.RowCount, rows.Count);
        foreach (var (row, actual) in expected.Rows.Zip(rows))
        {
            Assert.Equal(int.Parse(row["Row"], CultureInfo.InvariantCulture), actual.RowNumber);
            Assert.Equal(Unquote(row["Reference"]), actual.Reference);
            Assert.Equal(Unquote(row["TransactionDate"]), actual.TransactionDate);
            Assert.Equal(Unquote(row["AccountNumber"]), actual.AccountNumber);
            Assert.Equal(Unquote(row["Description"]), actual.Description);
            Assert.Equal(Unquote(row["Amount"]), actual.Amount);
            Assert.Equal(Unquote(row["TransactionType"]), actual.TransactionType);
            Assert.Equal(Unquote(row["Currency"]), actual.Currency);
            Assert.Equal(row["Reasons"], string.Join(ReasonSeparator, actual.Reasons));
        }
    }

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

    private InvalidRowListResponse ReadList() =>
        JsonSerializer.Deserialize<InvalidRowListResponse>(state.LastResponseBody, ResponseJson)
        ?? throw new InvalidOperationException("The response holds no list of invalid rows.");

    private static string Unquote(string value) =>
        value.Length >= 2 && value.StartsWith('\'') && value.EndsWith('\'') ? value[1..^1] : value;

    private sealed record InvalidRowListResponse(int TotalCount, List<InvalidRowResponse> Rows);

    private sealed record InvalidRowResponse(
        Guid Id,
        int RowNumber,
        string Reference,
        string TransactionDate,
        string AccountNumber,
        string Description,
        string Amount,
        string TransactionType,
        string Currency,
        List<string> Reasons);
}
