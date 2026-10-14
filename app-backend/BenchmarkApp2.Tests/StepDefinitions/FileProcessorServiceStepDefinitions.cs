using System.Text;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class FileProcessorServiceStepDefinitions(FileProcessorFixture fileProcessor, FileUploader uploader, ApiScenarioState state)
{
    private const int ConcurrentProcessorCount = 2;

    [Given("the file processor checks for waiting files every {int} seconds")]
    public void GivenTheFileProcessorChecksForWaitingFilesEvery(int seconds)
    {
        fileProcessor.Settings.FileProcessorPollIntervalSeconds = seconds;
    }

    [Given("the file processor service is started")]
    [When("the file processor service is started")]
    public Task WhenTheFileProcessorServiceIsStarted() => fileProcessor.Service.StartAsync(CancellationToken.None);

    [When("the file processor service is stopped")]
    public Task WhenTheFileProcessorServiceIsStopped() => fileProcessor.Service.StopAsync(CancellationToken.None);

    [Then("the file processor service is running")]
    public void ThenTheFileProcessorServiceIsRunning()
    {
        Assert.True(fileProcessor.Service.IsRunning);
    }

    [Then("the file processor service is not running")]
    public void ThenTheFileProcessorServiceIsNotRunning()
    {
        Assert.False(fileProcessor.Service.IsRunning);
    }

    [Then("the last uploaded file soon has the status {string}")]
    public Task ThenTheLastUploadedFileSoonHasTheStatus(string status) =>
        FileProcessorFixture.WaitForStatusAsync(state.LastUploadedFileId, status);

    [Given("I have uploaded {int} different files of {int} rows each")]
    public async Task GivenIHaveUploadedDifferentFilesOfRowsEach(int fileCount, int rowCount)
    {
        for (var file = 1; file <= fileCount; file++)
        {
            var content = new StringBuilder("Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency\n");
            for (var row = 1; row <= rowCount; row++)
            {
                content.Append($"TXN-{file}-{row},2026/04/15 08:12,1001,File {file} row {row},{row},D,ZAR\n");
            }
            await uploader.UploadAndRememberAsync(Encoding.UTF8.GetBytes(content.ToString()), $"file-{file}.csv");
        }
    }

    [When("two file processors process the waiting files at the same time")]
    public Task WhenTwoFileProcessorsProcessTheWaitingFilesAtTheSameTime() =>
        fileProcessor.ProcessWaitingFilesConcurrentlyAsync(ConcurrentProcessorCount);

    [Then("every uploaded file has the status {string}")]
    public async Task ThenEveryUploadedFileHasTheStatus(string status)
    {
        foreach (var fileId in state.UploadedFileIds)
        {
            Assert.Equal(status, (await TestDatabase.GetProcessedFileAsync(fileId)).Status);
        }
    }

    [Then("every uploaded file has exactly one {string} stage in its processing history")]
    public async Task ThenEveryUploadedFileHasExactlyOneStageInItsProcessingHistory(string stageName)
    {
        foreach (var fileId in state.UploadedFileIds)
        {
            Assert.Single(await TestDatabase.GetProcessingStagesAsync(fileId), stage => stage.Stage == stageName);
        }
    }
}
