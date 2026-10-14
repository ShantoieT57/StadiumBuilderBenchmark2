using System.Net;
using System.Text;
using System.Text.Json;
using BenchmarkApp2.Services.TransactionApi;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class CommonStepDefinitions(
    TransactionApiFixture api,
    FileProcessorFixture fileProcessor,
    FileUploader uploader,
    ApiScenarioState state,
    ManualTimeProvider clock)
{
    private const string SeededPassword = "Test123";

    [Given("I am signed in as {string}")]
    public async Task GivenIAmSignedInAs(string email)
    {
        state.SessionCookie = await SignInAsync(email);
    }

    [Given("I am signed in as {string} in browser {string}")]
    [When("I sign in as {string} in browser {string}")]
    public async Task GivenIAmSignedInAsInBrowser(string email, string browser)
    {
        state.BrowserSessionCookies[browser] = await SignInAsync(email);
    }

    [When("I request the current user")]
    public Task WhenIRequestTheCurrentUser() => RequestCurrentUserAsync(state.SessionCookie);

    [When("I request the current user from browser {string}")]
    public Task WhenIRequestTheCurrentUserFromBrowser(string browser) =>
        RequestCurrentUserAsync(state.GetBrowserSessionCookie(browser));

    [Given("{int} minutes pass")]
    [When("{int} minutes pass")]
    public void WhenMinutesPass(int minutes)
    {
        clock.Advance(TimeSpan.FromMinutes(minutes));
    }

    [Then("the response status code is {int}")]
    public void ThenTheResponseStatusCodeIs(int statusCode)
    {
        Assert.Equal(statusCode, (int)state.LastResponse.StatusCode);
    }

    [Then("the response message is {string}")]
    public void ThenTheResponseMessageIs(string message)
    {
        Assert.Equal(message, GetResponseProperty("message"));
    }

    [Then("the response reason is {string}")]
    public void ThenTheResponseReasonIs(string reason)
    {
        Assert.Equal(reason, GetResponseProperty("reason"));
    }

    [Then("the validation errors include the field {string}")]
    public void ThenTheValidationErrorsIncludeTheField(string field)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        var fields = json.RootElement.GetProperty("errors").EnumerateObject().Select(error => error.Name);
        Assert.Contains(fields, name => string.Equals(name, field, StringComparison.OrdinalIgnoreCase));
    }

    [Then("the response describes the user {string} with email {string} and role {string}")]
    public void ThenTheResponseDescribesTheUser(string name, string email, string role)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        Assert.Equal(name, json.RootElement.GetProperty("name").GetString());
        Assert.Equal(email, json.RootElement.GetProperty("email").GetString());
        Assert.Equal(role, json.RootElement.GetProperty("role").GetString());
    }

    [Then("my session has ended with the reason {string}")]
    public Task ThenMySessionHasEndedWithTheReason(string endReason) =>
        AssertSessionEndReasonAsync(state.SessionCookie!, endReason);

    [Then("the session in browser {string} has ended with the reason {string}")]
    public Task ThenTheSessionInBrowserHasEndedWithTheReason(string browser, string endReason) =>
        AssertSessionEndReasonAsync(state.GetBrowserSessionCookie(browser), endReason);

    [Given("I have uploaded the sample file {string}")]
    [When("I upload the sample file {string}")]
    public Task GivenIHaveUploadedTheSampleFile(string fileName) =>
        uploader.UploadAndRememberAsync(TestFiles.ReadSampleFile(fileName), fileName);

    [Given("I have uploaded the sample file {string} named {string}")]
    public Task GivenIHaveUploadedTheSampleFileNamed(string sampleFileName, string fileName) =>
        uploader.UploadAndRememberAsync(TestFiles.ReadSampleFile(sampleFileName), fileName);

    [Given("I have uploaded a file named {string} with the content:")]
    public Task GivenIHaveUploadedAFileNamedWithTheContent(string fileName, string content) =>
        uploader.UploadAndRememberAsync(Encoding.UTF8.GetBytes(content), fileName);

    [Given("I have uploaded a file named {string} with the rows:")]
    public Task GivenIHaveUploadedAFileNamedWithTheRows(string fileName, DataTable rows) =>
        uploader.UploadAndRememberAsync(TestFiles.ToCsv(rows), fileName);

    [Given("the file processor has processed the waiting files")]
    [When("the file processor processes the waiting files")]
    public Task WhenTheFileProcessorProcessesTheWaitingFiles() => fileProcessor.ProcessWaitingFilesAsync();

    [Given("uploaded file {int} has been left with the status {string}")]
    public Task GivenUploadedFileHasBeenLeftWithTheStatus(int position, string status) =>
        TestDatabase.SetFileStatusAsync(state.GetUploadedFileId(position), status);

    [Then("the last uploaded file has the status {string}")]
    public async Task ThenTheLastUploadedFileHasTheStatus(string status)
    {
        Assert.Equal(status, (await GetLastUploadedFileAsync()).Status);
    }

    [Then("uploaded file {int} has the status {string}")]
    public async Task ThenUploadedFileHasTheStatus(int position, string status)
    {
        Assert.Equal(status, (await TestDatabase.GetProcessedFileAsync(state.GetUploadedFileId(position))).Status);
    }

    [Then("the last uploaded file has {int} rows")]
    public async Task ThenTheLastUploadedFileHasRows(int rowCount)
    {
        Assert.Equal(rowCount, (await GetLastUploadedFileAsync()).RowCount);
    }

    [Then("the last uploaded file has {int} rows loaded, {int} skipped as existing and {int} ignored for an empty reference")]
    public async Task ThenTheLastUploadedFileHasRowsLoadedSkippedAndIgnored(int loaded, int skippedExisting, int ignoredEmptyReference)
    {
        var file = await GetLastUploadedFileAsync();
        Assert.Equal(loaded, file.LoadedCount);
        Assert.Equal(skippedExisting, file.SkippedExistingCount);
        Assert.Equal(ignoredEmptyReference, file.IgnoredEmptyReferenceCount);
        Assert.Equal(file.RowCount, loaded + skippedExisting + ignoredEmptyReference);
    }

    [Then("the last uploaded file was last processed at the current time")]
    public async Task ThenTheLastUploadedFileWasLastProcessedAtTheCurrentTime()
    {
        var lastProcessedAt = (await GetLastUploadedFileAsync()).LastProcessedAt;
        Assert.NotNull(lastProcessedAt);
        TimeAssert.IsCurrentTime(lastProcessedAt.Value, clock);
    }

    [Then("the last uploaded file has failed as a duplicate with the reason {string}")]
    public Task ThenTheLastUploadedFileHasFailedAsADuplicate(string reason) => AssertFailedAsync("Duplicate", reason);

    [Then("the last uploaded file has failed because of invalid rows with the reason {string}")]
    public Task ThenTheLastUploadedFileHasFailedBecauseOfInvalidRows(string reason) => AssertFailedAsync("InvalidRows", reason);

    [Then("no transactions have been loaded")]
    public async Task ThenNoTransactionsHaveBeenLoaded()
    {
        Assert.Empty(await TestDatabase.GetTransactionsAsync());
    }

    [Then("{int} transactions have been loaded in total")]
    public async Task ThenTransactionsHaveBeenLoadedInTotal(int count)
    {
        Assert.Equal(count, (await TestDatabase.GetTransactionsAsync()).Count);
    }

    [Then("the processing history of the last uploaded file lists the stages:")]
    public async Task ThenTheProcessingHistoryOfTheLastUploadedFileListsTheStages(DataTable stages)
    {
        var history = await TestDatabase.GetProcessingStagesAsync(state.LastUploadedFileId);
        Assert.Equal(stages.Rows.Select(row => row["Stage"]), history.Select(stage => stage.Stage));
    }

    private async Task AssertFailedAsync(string failureKind, string reason)
    {
        var file = await GetLastUploadedFileAsync();
        Assert.Equal("Failed", file.Status);
        Assert.Equal(failureKind, file.FailureKind);
        Assert.Equal(reason, file.FailureReason);
    }

    private Task<ProcessedFile> GetLastUploadedFileAsync() => TestDatabase.GetProcessedFileAsync(state.LastUploadedFileId);

    /// <summary>Signs in with the seeded password and returns the issued session cookie.</summary>
    private async Task<string> SignInAsync(string email)
    {
        var response = await api.SendAsync(HttpMethod.Post, "auth/sign-in", new { email, password = SeededPassword });
        await state.RecordResponseAsync(response);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var sessionCookie = state.IssuedSessionCookieValue;
        Assert.NotNull(sessionCookie);
        return sessionCookie;
    }

    private async Task RequestCurrentUserAsync(string? sessionCookie)
    {
        await state.RecordResponseAsync(await api.SendAsync(HttpMethod.Get, "auth/me", sessionCookie: sessionCookie));
    }

    private string? GetResponseProperty(string name)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        return json.RootElement.GetProperty(name).GetString();
    }

    private static async Task AssertSessionEndReasonAsync(string sessionCookie, string endReason)
    {
        Assert.Equal(endReason, await TestDatabase.GetSessionEndReasonAsync(SessionCookie.HashToken(sessionCookie)));
    }
}
