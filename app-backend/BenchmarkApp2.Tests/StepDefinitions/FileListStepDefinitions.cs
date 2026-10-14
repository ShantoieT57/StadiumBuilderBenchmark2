using System.Globalization;
using System.Text.Json;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class FileListStepDefinitions(TransactionApiFixture api, FileSeeder seeder, ApiScenarioState state)
{
    /// <summary>Reads the response exactly as sent: camelCase names, matched case-sensitively.</summary>
    private static readonly JsonSerializerOptions ResponseJson = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private readonly List<ListedFile> _filesFromAllPages = [];

    [Given("{int} files exist that were all last processed at {string}")]
    public async Task GivenFilesExistThatWereAllLastProcessedAt(int count, string lastProcessed)
    {
        for (var number = 1; number <= count; number++)
        {
            await seeder.SeedAsync(new SeedFile(
                FileName: $"file-{number:D2}.csv",
                Status: "Completed",
                FailureKind: null,
                FailureReason: null,
                LastProcessedAt: FileSeeder.ParseDateTime(lastProcessed),
                RowCount: 1,
                IsCancelled: false));
        }
    }

    [When("I list the files")]
    public Task WhenIListTheFiles() => ListFilesAsync(string.Empty);

    [When("I list the files with the query {string}")]
    public Task WhenIListTheFilesWithTheQuery(string query) => ListFilesAsync(query);

    [When("I list pages {int} to {int} of the files with the query {string}")]
    public async Task WhenIListPagesOfTheFilesWithTheQuery(int firstPage, int lastPage, string query)
    {
        for (var page = firstPage; page <= lastPage; page++)
        {
            await ListFilesAsync($"{query}&page={page}");
            Assert.Equal(200, (int)state.LastResponse.StatusCode);
            _filesFromAllPages.AddRange(ReadPage().Items);
        }
    }

    [Then("the listed files are:")]
    public void ThenTheListedFilesAre(DataTable expected)
    {
        var items = ReadPage().Items;
        Assert.Equal(expected.Rows.Count, items.Count);
        foreach (var (row, item) in expected.Rows.Zip(items))
        {
            Assert.Equal(row["name"], item.FileName);
            Assert.Equal(seeder.GetFileId(row["name"]), item.Id);
            AssertColumn(row, "status", item.Status);
            AssertColumn(row, "failure kind", item.FailureKind);
            AssertColumn(row, "failure reason", item.FailureReason);
            AssertColumn(row, "rows", item.RowCount?.ToString(CultureInfo.InvariantCulture));
            AssertColumn(row, "imported", item.ImportedCount.ToString(CultureInfo.InvariantCulture));
            AssertColumn(row, "cancelled", item.IsCancelled ? "yes" : "no");
            if (row.ContainsKey("last processed"))
            {
                Assert.Equal(FileSeeder.ParseDateTime(row["last processed"]), item.LastProcessedAt);
            }
        }
    }

    [Then("the listed file names are {string}")]
    public void ThenTheListedFileNamesAre(string names)
    {
        Assert.Equal(SplitList(names), ReadPage().Items.Select(item => item.FileName));
    }

    [Then("the listed files are cancelled: {string}")]
    public void ThenTheListedFilesAreCancelled(string cancelled)
    {
        Assert.Equal(SplitList(cancelled), ReadPage().Items.Select(item => item.IsCancelled ? "yes" : "no"));
    }

    [Then("no files are listed")]
    public void ThenNoFilesAreListed()
    {
        var page = ReadPage();
        Assert.Empty(page.Items);
        Assert.Equal(0, page.TotalCount);
    }

    [Then("the page lists {int} files")]
    public void ThenThePageListsFiles(int count)
    {
        Assert.Equal(count, ReadPage().Items.Count);
    }

    [Then("the page is {int} of {int} with page size {int} and {int} files in total")]
    public void ThenThePageIs(int page, int totalPages, int pageSize, int totalCount)
    {
        var actual = ReadPage();
        Assert.Equal((page, totalPages, pageSize, totalCount), (actual.Page, actual.TotalPages, actual.PageSize, actual.TotalCount));
    }

    [Then("every one of the {int} files is listed exactly once")]
    public void ThenEveryOneOfTheFilesIsListedExactlyOnce(int count)
    {
        Assert.Equal(count, _filesFromAllPages.Count);
        Assert.Equal(seeder.FileIdsInReceivedOrder.Order(), _filesFromAllPages.Select(file => file.Id).Order());
    }

    [Then("the files are listed in the reverse of the order they were received")]
    public void ThenTheFilesAreListedInTheReverseOfTheOrderTheyWereReceived()
    {
        Assert.Equal(Enumerable.Reverse(seeder.FileIdsInReceivedOrder), _filesFromAllPages.Select(file => file.Id));
    }

    private async Task ListFilesAsync(string query)
    {
        var path = query.Length == 0 ? "files" : $"files?{query.TrimStart('&')}";
        await state.RecordResponseAsync(await api.SendAsync(HttpMethod.Get, path, sessionCookie: state.SessionCookie));
    }

    private FilePageResponse ReadPage() =>
        JsonSerializer.Deserialize<FilePageResponse>(state.LastResponseBody, ResponseJson)
        ?? throw new InvalidOperationException("The response holds no page of files.");

    private static void AssertColumn(DataTableRow row, string column, string? actual)
    {
        if (row.TryGetValue(column, out var expected))
        {
            Assert.Equal(expected.Length == 0 ? null : expected, actual);
        }
    }

    private static string[] SplitList(string values) =>
        values.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

    private sealed record FilePageResponse(List<ListedFile> Items, int Page, int PageSize, int TotalCount, int TotalPages);

    private sealed record ListedFile(
        Guid Id,
        string FileName,
        string Status,
        string? FailureKind,
        string? FailureReason,
        DateTimeOffset? LastProcessedAt,
        int? RowCount,
        int ImportedCount,
        bool IsCancelled);
}
