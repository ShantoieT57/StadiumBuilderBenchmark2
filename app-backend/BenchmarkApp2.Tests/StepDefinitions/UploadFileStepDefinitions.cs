using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class UploadFileStepDefinitions(TransactionApiFixture api, ApiScenarioState state, ManualTimeProvider clock)
{
    private const string UploadPath = "files";
    private const string SampleFilesFolder = "TestFiles";

    /// <summary>Database timestamps keep microseconds, so times are compared to the nearest millisecond.</summary>
    private static readonly TimeSpan TimeTolerance = TimeSpan.FromMilliseconds(1);

    private byte[] _uploadedContent = [];

    [Given("the maximum upload size is {int} bytes")]
    public void GivenTheMaximumUploadSizeIs(int bytes)
    {
        api.Settings.MaxUploadSizeBytes = bytes;
    }

    [When("I upload the sample file {string} as the kind {string}")]
    public Task WhenIUploadTheSampleFileAsTheKind(string fileName, string kind) =>
        UploadAsync(ReadSampleFile(fileName), fileName, kind);

    [When("I upload the sample file {string} without choosing a kind")]
    public Task WhenIUploadTheSampleFileWithoutChoosingAKind(string fileName) =>
        UploadAsync(ReadSampleFile(fileName), fileName, kind: null);

    [When("I upload a file named {string} as the kind {string}")]
    public Task WhenIUploadAFileNamedAsTheKind(string fileName, string kind) =>
        UploadAsync(CreateCsvContent(100), fileName, kind);

    [When("I upload a file named {string}")]
    public Task WhenIUploadAFileNamed(string fileName) =>
        UploadAsync(CreateCsvContent(100), fileName, kind: null);

    [When("I upload a .csv file whose name is {int} characters long")]
    public Task WhenIUploadACsvFileWhoseNameIsCharactersLong(int length) =>
        UploadAsync(CreateCsvContent(100), new string('t', length - ".csv".Length) + ".csv", kind: null);

    [When("I upload a .csv file of {int} bytes")]
    public Task WhenIUploadACsvFileOfBytes(int length) =>
        UploadAsync(CreateCsvContent(length), "transactions.csv", kind: null);

    [When("I send an upload request without a file")]
    public async Task WhenISendAnUploadRequestWithoutAFile()
    {
        var form = new MultipartFormDataContent { { new StringContent("BankTransactions"), "kind" } };
        await state.RecordResponseAsync(await api.SendContentAsync(HttpMethod.Post, UploadPath, form, state.SessionCookie));
    }

    [Then("the response describes the uploaded file {string} of kind {string} with status {string}")]
    public void ThenTheResponseDescribesTheUploadedFile(string fileName, string kind, string status)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        var root = json.RootElement;
        Assert.NotEqual(Guid.Empty, root.GetProperty("id").GetGuid());
        Assert.Equal(fileName, root.GetProperty("fileName").GetString());
        Assert.Equal(kind, root.GetProperty("kind").GetString());
        Assert.Equal(status, root.GetProperty("status").GetString());
    }

    [Then("the response upload time is the current time")]
    public void ThenTheResponseUploadTimeIsTheCurrentTime()
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        var uploadedAt = json.RootElement.GetProperty("uploadedAt").GetDateTimeOffset();
        Assert.Equal(clock.GetUtcNow(), uploadedAt, TimeTolerance);
    }

    [Then("exactly one file has been stored")]
    public async Task ThenExactlyOneFileHasBeenStored()
    {
        Assert.Single(await TestDatabase.GetStoredFilesAsync());
    }

    [Then("no file has been stored")]
    public async Task ThenNoFileHasBeenStored()
    {
        Assert.Empty(await TestDatabase.GetStoredFilesAsync());
    }

    [Then("the stored file is the uploaded file {string} of kind {string} with status {string}")]
    public async Task ThenTheStoredFileIsTheUploadedFile(string fileName, string kind, string status)
    {
        var storedFile = await GetStoredFileAsync();
        using var json = JsonDocument.Parse(state.LastResponseBody);
        Assert.Equal(json.RootElement.GetProperty("id").GetGuid(), storedFile.Id);
        Assert.Equal(fileName, storedFile.FileName);
        Assert.Equal(kind, storedFile.Kind);
        Assert.Equal(status, storedFile.Status);
    }

    [Then("the stored file has exactly the bytes of the uploaded file")]
    public async Task ThenTheStoredFileHasExactlyTheBytesOfTheUploadedFile()
    {
        Assert.Equal(_uploadedContent, (await GetStoredFileAsync()).Content);
    }

    [Then("the stored file has the SHA-256 hash of the uploaded file")]
    public async Task ThenTheStoredFileHasTheSha256HashOfTheUploadedFile()
    {
        Assert.Equal(SHA256.HashData(_uploadedContent), (await GetStoredFileAsync()).ContentSha256);
    }

    [Then("the stored file was uploaded by {string} at the current time")]
    public async Task ThenTheStoredFileWasUploadedByAtTheCurrentTime(string email)
    {
        var storedFile = await GetStoredFileAsync();
        Assert.Equal(email, storedFile.UploadedByEmail);
        Assert.Equal(clock.GetUtcNow(), new DateTimeOffset(storedFile.UploadedAt, TimeSpan.Zero), TimeTolerance);
    }

    private async Task UploadAsync(byte[] content, string fileName, string? kind)
    {
        _uploadedContent = content;

        var fileContent = new ByteArrayContent(content);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("text/csv");
        fileContent.Headers.ContentDisposition = new ContentDispositionHeaderValue("form-data")
        {
            Name = "\"file\"",
            FileName = $"\"{fileName}\"",
        };

        var form = new MultipartFormDataContent { fileContent };
        if (kind is not null)
        {
            form.Add(new StringContent(kind), "kind");
        }

        await state.RecordResponseAsync(await api.SendContentAsync(HttpMethod.Post, UploadPath, form, state.SessionCookie));
    }

    private static async Task<StoredFile> GetStoredFileAsync() => Assert.Single(await TestDatabase.GetStoredFilesAsync());

    private static byte[] ReadSampleFile(string fileName) =>
        File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, SampleFilesFolder, fileName));

    /// <summary>A .csv file of exactly the given length: a header row padded with transaction rows.</summary>
    private static byte[] CreateCsvContent(int length)
    {
        var builder = new StringBuilder("Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency\n");
        while (builder.Length < length)
        {
            builder.Append("TXN-1,2026/04/15 08:12,1001-2034-5567,Test,1,C,ZAR\n");
        }
        return Encoding.ASCII.GetBytes(builder.ToString(0, length));
    }
}
