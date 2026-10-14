using System.Text;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class DownloadFileStepDefinitions(TransactionApiFixture api, FileSeeder seeder, FileUploader uploader, ApiScenarioState state)
{
    private byte[] _downloadedBytes = [];

    [Given("I have uploaded the sample file {string} with a UTF-8 byte-order mark, a line feed ending and a café row")]
    public Task GivenIHaveUploadedTheSampleFileWithAByteOrderMark(string fileName)
    {
        // The sample file ends its lines with CR LF; the added row ends with LF alone and has no
        // ending at all after it, so both kinds of line ending and a missing final one are kept.
        byte[] content =
        [
            .. Encoding.UTF8.GetPreamble(),
            .. TestFiles.ReadSampleFile(fileName),
            .. Encoding.UTF8.GetBytes("TXN-CAFE-1,2026/04/15 18:00,1001-2034-5567,Café Crème,42.50,D,ZAR\nTXN-CAFE-2,2026/04/15 18:01,1001,Naïve,1,D,ZAR"),
        ];
        return uploader.UploadAndRememberAsync(content, "bom.csv");
    }

    [Given("a file named {string} exists with the content of the sample file {string}")]
    public Task GivenAFileNamedExistsWithTheContentOfTheSampleFile(string fileName, string sampleFileName) =>
        seeder.SeedAsync(new SeedFile(
            FileName: fileName,
            Status: "Completed",
            FailureKind: null,
            FailureReason: null,
            LastProcessedAt: null,
            RowCount: null,
            IsCancelled: false,
            Content: TestFiles.ReadSampleFile(sampleFileName)));

    [Given("the original content of uploaded file {int} has been discarded")]
    public Task GivenTheOriginalContentOfUploadedFileHasBeenDiscarded(int position) =>
        TestDatabase.DiscardFileContentAsync(state.GetUploadedFileId(position));

    [When("I download the last uploaded file")]
    public Task WhenIDownloadTheLastUploadedFile() => DownloadAsync(state.LastUploadedFileId);

    [When("I download the file {string}")]
    public Task WhenIDownloadTheFile(string fileName) => DownloadAsync(seeder.GetFileId(fileName));

    [When("I download a file that does not exist")]
    public Task WhenIDownloadAFileThatDoesNotExist() => DownloadAsync(Guid.NewGuid());

    [Then("the downloaded bytes are exactly the bytes of the sample file {string}")]
    public void ThenTheDownloadedBytesAreExactlyTheBytesOfTheSampleFile(string fileName)
    {
        Assert.Equal(TestFiles.ReadSampleFile(fileName), _downloadedBytes);
    }

    [Then("the downloaded bytes are exactly the bytes that were uploaded")]
    public void ThenTheDownloadedBytesAreExactlyTheBytesThatWereUploaded()
    {
        Assert.Equal(state.LastUploadedFileContent, _downloadedBytes);
    }

    private async Task DownloadAsync(Guid fileId)
    {
        var response = await api.SendAsync(HttpMethod.Get, $"files/{fileId}/content", sessionCookie: state.SessionCookie);
        _downloadedBytes = await response.Content.ReadAsByteArrayAsync();
        await state.RecordResponseAsync(response);
    }
}
