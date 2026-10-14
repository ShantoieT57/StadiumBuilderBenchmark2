using System.Text.Json;
using System.Text.RegularExpressions;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed partial class TransactionListStepDefinitions(
    TransactionApiFixture api,
    FileSeeder fileSeeder,
    TransactionSeeder transactionSeeder,
    ApiScenarioState state)
{
    /// <summary>Reads the response exactly as sent: camelCase names, matched case-sensitively.</summary>
    private static readonly JsonSerializerOptions ResponseJson = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private readonly List<string> _referencesFromAllPages = [];

    [Given("{int} transactions exist that are all dated {string}")]
    public Task GivenTransactionsExistThatAreAllDated(int count, string date) => transactionSeeder.SeedManyAsync(count, date);

    [When("I list the transactions")]
    public Task WhenIListTheTransactions() => ListTransactionsAsync(string.Empty);

    [When("I list the transactions with the query {string}")]
    public Task WhenIListTheTransactionsWithTheQuery(string query) => ListTransactionsAsync(query);

    [When("I list pages {int} to {int} of the transactions with the query {string}")]
    public async Task WhenIListPagesOfTheTransactionsWithTheQuery(int firstPage, int lastPage, string query)
    {
        for (var page = firstPage; page <= lastPage; page++)
        {
            await ListTransactionsAsync($"{query}&page={page}");
            Assert.Equal(200, (int)state.LastResponse.StatusCode);
            _referencesFromAllPages.AddRange(ListedReferences());
        }
    }

    /// <summary>
    /// Compares every listed transaction with the expected row, in order. The amount is compared with
    /// the exact JSON text, so it must be a number with two decimal places.
    /// </summary>
    [Then("the listed transactions are:")]
    public void ThenTheListedTransactionsAre(DataTable expected)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        var items = json.RootElement.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(expected.RowCount, items.Count);
        foreach (var (row, item) in expected.Rows.Zip(items))
        {
            var reference = row["reference"];
            Assert.Equal(transactionSeeder.GetTransactionId(reference), item.GetProperty("id").GetGuid());
            Assert.Equal(reference, item.GetProperty("reference").GetString());
            Assert.Equal(row["date"], item.GetProperty("transactionDate").GetString());
            Assert.Equal(row["account"], item.GetProperty("accountNumber").GetString());
            Assert.Equal(row["description"], item.GetProperty("description").GetString());
            Assert.Equal(JsonValueKind.Number, item.GetProperty("amount").ValueKind);
            Assert.Equal(row["amount"], item.GetProperty("amount").GetRawText());
            Assert.Equal(row["currency"], item.GetProperty("currency").GetString());
            Assert.Equal(row["type"], item.GetProperty("transactionType").GetString());
            Assert.Equal(row["status"], item.GetProperty("status").GetString());
            var file = item.GetProperty("file");
            Assert.Equal(fileSeeder.GetFileId(row["file"]), file.GetProperty("id").GetGuid());
            Assert.Equal(row["file"], file.GetProperty("fileName").GetString());
        }
    }

    [Then("the listed references are {string}")]
    public void ThenTheListedReferencesAre(string references)
    {
        Assert.Equal(references.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries), ListedReferences());
    }

    [Then("no transactions are listed")]
    public void ThenNoTransactionsAreListed()
    {
        var page = ReadPage();
        Assert.Empty(page.Items);
        Assert.Equal(0, page.TotalCount);
    }

    [Then("the page lists {int} transactions")]
    public void ThenThePageListsTransactions(int count)
    {
        Assert.Equal(count, ReadPage().Items.Count);
    }

    [Then("the page is {int} of {int} with page size {int} and {int} transactions in total")]
    public void ThenThePageIs(int page, int totalPages, int pageSize, int totalCount)
    {
        var actual = ReadPage();
        Assert.Equal((page, totalPages, pageSize, totalCount), (actual.Page, actual.TotalPages, actual.PageSize, actual.TotalCount));
    }

    [Then("the list says that transactions exist")]
    public void ThenTheListSaysThatTransactionsExist()
    {
        Assert.True(ReadPage().HasAnyTransactions);
    }

    [Then("the list says that no transactions exist")]
    public void ThenTheListSaysThatNoTransactionsExist()
    {
        Assert.False(ReadPage().HasAnyTransactions);
    }

    [Then("every one of the {int} transactions is listed exactly once")]
    public void ThenEveryOneOfTheTransactionsIsListedExactlyOnce(int count)
    {
        Assert.Equal(count, _referencesFromAllPages.Count);
        Assert.Equal(count, _referencesFromAllPages.Distinct().Count());
    }

    [Then("the transactions from all pages are listed by reference, {word}")]
    public void ThenTheTransactionsFromAllPagesAreListedByReference(string order)
    {
        var sorted = _referencesFromAllPages.Order(StringComparer.OrdinalIgnoreCase).ToList();
        if (order == "descending")
        {
            sorted.Reverse();
        }
        Assert.Equal(sorted, _referencesFromAllPages);
    }

    /// <summary>Sends the query after replacing each "{file name}" with the id of that seeded file.</summary>
    private async Task ListTransactionsAsync(string query)
    {
        var resolved = FileNamePlaceholder().Replace(query, match => fileSeeder.GetFileId(match.Groups[1].Value).ToString());
        var path = resolved.Length == 0 ? "transactions" : $"transactions?{resolved.TrimStart('&')}";
        await state.RecordResponseAsync(await api.SendAsync(HttpMethod.Get, path, sessionCookie: state.SessionCookie));
    }

    private List<string> ListedReferences() => ReadPage().Items.Select(item => item.Reference).ToList();

    private TransactionPageResponse ReadPage() =>
        JsonSerializer.Deserialize<TransactionPageResponse>(state.LastResponseBody, ResponseJson)
        ?? throw new InvalidOperationException("The response holds no page of transactions.");

    [GeneratedRegex(@"\{([^}]+)\}")]
    private static partial Regex FileNamePlaceholder();

    private sealed record TransactionPageResponse(
        List<ListedTransaction> Items, int Page, int PageSize, int TotalCount, int TotalPages, bool HasAnyTransactions);

    private sealed record ListedTransaction(Guid Id, string Reference);
}
