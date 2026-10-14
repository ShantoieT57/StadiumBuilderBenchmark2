using System.Text;
using System.Text.Json;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class ExportTransactionsStepDefinitions(
    TransactionApiFixture api,
    FileSeeder fileSeeder,
    TransactionSeeder transactionSeeder,
    ApiScenarioState state)
{
    private const string ReferenceColumn = "Reference";
    private const string LineEnding = "\r\n";
    private const int ListPageSize = 50;

    private byte[] _exportedBytes = [];

    [Given("{int} transactions with varied values exist")]
    public Task GivenTransactionsWithVariedValuesExist(int count) => transactionSeeder.SeedVariedAsync(count);

    [Given("the transaction {string} exists with the description {string}")]
    public Task GivenTheTransactionExistsWithTheDescription(string reference, string description) =>
        transactionSeeder.SeedWithDescriptionAsync(reference, TableText.ExpandControlCharacters(description));

    [Given("the export time zone is {string}")]
    public void GivenTheExportTimeZoneIs(string timeZone)
    {
        api.Settings.ExportTimeZone = timeZone;
    }

    [When("I export the transactions")]
    public Task WhenIExportTheTransactions() => ExportAsync(string.Empty);

    [When("I export the transactions with the query {string}")]
    public Task WhenIExportTheTransactionsWithTheQuery(string query) => ExportAsync(query);

    /// <summary>The table's headings must be the export's header row, and its rows the exported rows, in order.</summary>
    [Then("the exported rows are:")]
    public void ThenTheExportedRowsAre(DataTable expected)
    {
        var records = ReadRecords();
        Assert.Equal(expected.Header, records[0]);
        Assert.Equal(expected.Rows.Select(row => row.Values.ToList()), records.Skip(1));
    }

    [Then("the export starts with a UTF-8 byte-order mark")]
    public void ThenTheExportStartsWithAUtf8ByteOrderMark()
    {
        Assert.Equal(Encoding.UTF8.GetPreamble(), _exportedBytes.Take(3));
    }

    /// <summary>Reading the export strictly fails on any line break outside quotes that is not CR LF, or on a missing last one.</summary>
    [Then("every line of the export ends with a carriage return and a line feed")]
    public void ThenEveryLineOfTheExportEndsWithACarriageReturnAndALineFeed()
    {
        Assert.NotEmpty(ReadRecords());
    }

    /// <summary>The lines of the text are compared as if each ended with CR LF.</summary>
    [Then("the export text is:")]
    public void ThenTheExportTextIs(string expected)
    {
        Assert.Equal(string.Join(LineEnding, expected.ReplaceLineEndings("\n").Split('\n')) + LineEnding, ExportText());
    }

    /// <summary>The Description is written between the Account Number and the Amount, so the raw text holds it between commas.</summary>
    [Then("the exported Description of {string} is written as {string}")]
    public void ThenTheExportedDescriptionIsWrittenAs(string reference, string written)
    {
        FindRecord(reference);
        Assert.Contains($",{TableText.ExpandControlCharacters(written)},", ExportText());
    }

    [Then("the exported {} of {string} reads back as {string}")]
    public void ThenTheExportedColumnReadsBackAs(string column, string reference, string value)
    {
        var records = ReadRecords();
        var columnIndex = records[0].IndexOf(column);
        Assert.True(columnIndex >= 0, $"The export has no column \"{column}\".");
        Assert.Equal(TableText.ExpandControlCharacters(value), FindRecord(reference)[columnIndex]);
    }

    [Then("the export holds {int} transactions")]
    public void ThenTheExportHoldsTransactions(int count)
    {
        Assert.Equal(count, ReadRecords().Count - 1);
    }

    [Then("the exported references are {string}")]
    public void ThenTheExportedReferencesAre(string references)
    {
        Assert.Equal(references.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries), ExportedReferences());
    }

    [Then("the exported references are those of every page of the list with the query {string}")]
    public async Task ThenTheExportedReferencesAreThoseOfEveryPageOfTheList(string query)
    {
        var exported = ExportedReferences();
        Assert.Equal(await ListReferencesOfEveryPageAsync(query), exported);
    }

    private async Task ExportAsync(string query)
    {
        var response = await api.SendAsync(HttpMethod.Get, QueryText.ToPath("transactions/export", query, fileSeeder), sessionCookie: state.SessionCookie);
        _exportedBytes = await response.Content.ReadAsByteArrayAsync();
        await state.RecordResponseAsync(response);
    }

    /// <summary>Lists every page of the transactions with the query, without changing the scenario's last response.</summary>
    private async Task<List<string>> ListReferencesOfEveryPageAsync(string query)
    {
        var references = new List<string>();
        for (var page = 1; ; page++)
        {
            var path = QueryText.ToPath("transactions", $"{query}&pageSize={ListPageSize}&page={page}", fileSeeder);
            using var response = await api.SendAsync(HttpMethod.Get, path, sessionCookie: state.SessionCookie);
            response.EnsureSuccessStatusCode();
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var items = json.RootElement.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("reference").GetString()!).ToList();
            if (items.Count == 0)
            {
                return references;
            }
            references.AddRange(items);
        }
    }

    /// <summary>The export decoded as UTF-8 without its byte-order mark.</summary>
    private string ExportText()
    {
        var preamble = Encoding.UTF8.GetPreamble();
        var hasPreamble = _exportedBytes.AsSpan().StartsWith(preamble);
        return Encoding.UTF8.GetString(hasPreamble ? _exportedBytes[preamble.Length..] : _exportedBytes);
    }

    private List<List<string>> ReadRecords() => CsvText.Parse(ExportText());

    private List<string> ExportedReferences()
    {
        var records = ReadRecords();
        var referenceIndex = records[0].IndexOf(ReferenceColumn);
        return records.Skip(1).Select(record => record[referenceIndex]).ToList();
    }

    private List<string> FindRecord(string reference)
    {
        var records = ReadRecords();
        var referenceIndex = records[0].IndexOf(ReferenceColumn);
        return Assert.Single(records.Skip(1), record => record[referenceIndex] == reference);
    }
}
