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

    /// <summary>Database timestamps keep microseconds, so times are compared to the nearest millisecond.</summary>
    private static readonly TimeSpan TimeTolerance = TimeSpan.FromMilliseconds(1);

    private const string RawBoundary = "upload-boundary";
    private const string RawMultipartContentType = $"multipart/form-data; boundary={RawBoundary}";
    private const string FilePartHead =
        $"--{RawBoundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"transactions.csv\"\r\nContent-Type: text/csv\r\n\r\n";
    private const string CsvBody = "Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency\n";

    private byte[] _uploadedContent = [];

    [Given("the maximum upload size is {int} bytes")]
    public void GivenTheMaximumUploadSizeIs(int bytes)
    {
        api.Settings.MaxUploadSizeBytes = bytes;
    }

    [When("I upload the sample file {string} as the kind {string}")]
    public Task WhenIUploadTheSampleFileAsTheKind(string fileName, string kind) =>
        UploadAsync(TestFiles.ReadSampleFile(fileName), fileName, kind);

    [When("I upload the sample file {string} without choosing a kind")]
    public Task WhenIUploadTheSampleFileWithoutChoosingAKind(string fileName) =>
        UploadAsync(TestFiles.ReadSampleFile(fileName), fileName, kind: null);

    [When("I upload a file named {string} as the kind {string}")]
    public Task WhenIUploadAFileNamedAsTheKind(string fileName, string kind) =>
        UploadAsync(TestFiles.CreateCsvContent(100), fileName, kind);

    [When("I upload a file named {string}")]
    public Task WhenIUploadAFileNamed(string fileName) =>
        UploadAsync(TestFiles.CreateCsvContent(100), fileName, kind: null);

    [When("I upload a file named {string} of {int} bytes")]
    public Task WhenIUploadAFileNamedOfBytes(string fileName, int length) =>
        UploadAsync(TestFiles.CreateCsvContent(length), fileName, kind: null);

    [When("I upload a .csv file whose name is {int} characters long")]
    public Task WhenIUploadACsvFileWhoseNameIsCharactersLong(int length) =>
        UploadAsync(TestFiles.CreateCsvContent(100), new string('t', length - ".csv".Length) + ".csv", kind: null);

    [When("I upload a .csv file of {int} bytes")]
    public Task WhenIUploadACsvFileOfBytes(int length) =>
        UploadAsync(TestFiles.CreateCsvContent(length), "transactions.csv", kind: null);

    [When("I send an upload request without a file")]
    public Task WhenISendAnUploadRequestWithoutAFile() =>
        SendAsync(new MultipartFormDataContent { { new StringContent("BankTransactions"), "kind" } });

    [When("I send an upload request with a plain form field {string} of {int} bytes")]
    public Task WhenISendAnUploadRequestWithAPlainFormField(string fieldName, int length) =>
        SendAsync(new MultipartFormDataContent { { new ByteArrayContent(TestFiles.CreateCsvContent(length)), fieldName } });

    [When("I upload the files {string} in the field {string} and {string} in the field {string} in one request")]
    public Task WhenIUploadTwoFilesInOneRequest(string firstFileName, string firstField, string secondFileName, string secondField) =>
        SendAsync(new MultipartFormDataContent
        {
            TestFiles.CreateFilePart(TestFiles.CreateCsvContent(100), firstFileName, firstField),
            TestFiles.CreateFilePart(TestFiles.CreateCsvContent(100), secondFileName, secondField),
        });

    [When("I upload the file {string} in the field {string}")]
    public Task WhenIUploadTheFileInTheField(string fileName, string fieldName) =>
        SendAsync(new MultipartFormDataContent { TestFiles.CreateFilePart(TestFiles.CreateCsvContent(100), fileName, fieldName) });

    [When("I send an upload request with the content type {string}")]
    public Task WhenISendAnUploadRequestWithTheContentType(string contentType)
    {
        var content = new ByteArrayContent(TestFiles.CreateCsvContent(100));
        content.Headers.TryAddWithoutValidation("Content-Type", contentType);
        return SendAsync(content);
    }

    [When("I send an upload request without a content type")]
    public Task WhenISendAnUploadRequestWithoutAContentType() =>
        SendAsync(new ByteArrayContent(TestFiles.CreateCsvContent(100)));

    [When("I send an upload request whose multipart content type has no boundary")]
    public Task WhenISendAnUploadRequestWithoutABoundary() =>
        SendRawMultipartAsync("multipart/form-data", $"{FilePartHead}{CsvBody}\r\n--{RawBoundary}--\r\n");

    [When("I send an upload request whose body ends before its closing boundary")]
    public Task WhenISendATruncatedUploadRequest() =>
        SendRawMultipartAsync(RawMultipartContentType, $"{FilePartHead}{CsvBody}");

    [When("I send an upload request whose part header has no colon")]
    public Task WhenISendAnUploadRequestWithAnUnreadablePartHeader() =>
        SendRawMultipartAsync(
            RawMultipartContentType,
            $"--{RawBoundary}\r\nContent-Disposition form-data; name=\"file\"; filename=\"transactions.csv\"\r\n\r\n{CsvBody}\r\n--{RawBoundary}--\r\n");

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
        TimeAssert.IsCurrentTime(storedFile.UploadedAt, clock);
    }

    private async Task UploadAsync(byte[] content, string fileName, string? kind)
    {
        _uploadedContent = content;
        await SendAsync(TestFiles.CreateUploadForm(content, fileName, kind));
    }

    private async Task SendAsync(HttpContent content) =>
        await state.RecordResponseAsync(await api.SendContentAsync(HttpMethod.Post, UploadPath, content, state.SessionCookie));

    /// <summary>Sends exactly this text as the body, with exactly this Content-Type header.</summary>
    private Task SendRawMultipartAsync(string contentType, string body)
    {
        var content = new ByteArrayContent(Encoding.ASCII.GetBytes(body));
        content.Headers.TryAddWithoutValidation("Content-Type", contentType);
        return SendAsync(content);
    }

    private static async Task<StoredFile> GetStoredFileAsync() => Assert.Single(await TestDatabase.GetStoredFilesAsync());
}
