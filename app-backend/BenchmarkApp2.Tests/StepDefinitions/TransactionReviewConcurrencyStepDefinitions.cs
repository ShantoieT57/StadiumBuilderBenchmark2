using System.Net;
using System.Text.Json;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class TransactionReviewConcurrencyStepDefinitions(
    TransactionApiFixture api,
    FileSeeder fileSeeder,
    TransactionSeeder transactionSeeder,
    ApiScenarioState state,
    ReviewClient reviewer,
    CancelClient canceller,
    HeldDatabaseLock heldLock)
{
    private static readonly TimeSpan FinishTimeout = TimeSpan.FromSeconds(15);

    /// <summary>The requests started in this scenario, by the browser that sent them.</summary>
    private readonly Dictionary<string, StartedRequest> _requests = [];

    /// <summary>The requests that have finished, by the browser that sent them.</summary>
    private readonly Dictionary<string, FinishedRequest> _finished = [];

    [Given("another approver {string} with the email {string} exists")]
    public Task GivenAnotherApproverExists(string name, string email) => TestDatabase.InsertApproverAsync(name, email);

    [Given("another database session holds the transaction {string} locked")]
    public Task GivenAnotherDatabaseSessionHoldsTheTransactionLocked(string reference) =>
        heldLock.LockTransactionAsync(transactionSeeder.GetTransactionId(reference));

    [Given("another database session holds the file {string} locked")]
    public Task GivenAnotherDatabaseSessionHoldsTheFileLocked(string fileName) =>
        heldLock.LockFileAsync(fileSeeder.GetFileId(fileName));

    [When("browser {string} starts approving the transaction {string}")]
    public void WhenBrowserStartsApprovingTheTransaction(string browser, string reference)
    {
        var id = transactionSeeder.GetTransactionId(reference);
        var cookie = state.GetBrowserSessionCookie(browser);
        Start(browser, RequestKind.Approve, () => reviewer.SendApproveAsync(id, cookie));
    }

    [When("browser {string} starts rejecting the transaction {string} with the reason {string}")]
    public void WhenBrowserStartsRejectingTheTransaction(string browser, string reference, string reason)
    {
        var id = transactionSeeder.GetTransactionId(reference);
        var cookie = state.GetBrowserSessionCookie(browser);
        Start(browser, RequestKind.Reject, () => reviewer.SendRejectAsync(id, reason, cookie), reason);
    }

    [When("browser {string} starts cancelling the file {string}")]
    public void WhenBrowserStartsCancellingTheFile(string browser, string fileName)
    {
        var id = fileSeeder.GetFileId(fileName);
        var cookie = state.GetBrowserSessionCookie(browser);
        Start(browser, RequestKind.Cancel, () => canceller.SendCancelAsync(id, cookie));
    }

    [When("{int} request(s) is/are waiting for the lock")]
    public Task WhenRequestsAreWaitingForTheLock(int count) => HeldDatabaseLock.WaitForSessionsWaitingAsync(count);

    [When("the other database session releases its locks")]
    public Task WhenTheOtherDatabaseSessionReleasesItsLocks() => heldLock.ReleaseAsync();

    [Then("the request in browser {string} finishes with the response status code {int}")]
    public async Task ThenTheRequestInBrowserFinishesWithTheResponseStatusCode(string browser, int statusCode)
    {
        var finished = await FinishAsync(browser);
        await state.RecordResponseAsync(finished.Response);
        Assert.Equal(statusCode, (int)finished.Response.StatusCode);
    }

    [Then("one of the requests in browsers {string} and {string} succeeds and the other is refused with 409")]
    public async Task ThenOneOfTheRequestsSucceedsAndTheOtherIsRefused(string firstBrowser, string secondBrowser)
    {
        var first = await FinishAsync(firstBrowser);
        var second = await FinishAsync(secondBrowser);
        Assert.Equal(
            [HttpStatusCode.OK, HttpStatusCode.Conflict],
            new[] { first.Response.StatusCode, second.Response.StatusCode }.Order());
    }

    [Then("the refused request says {string} and shows the transaction as {string}")]
    public void ThenTheRefusedRequestSays(string message, string status)
    {
        using var json = JsonDocument.Parse(Refused.Body);
        Assert.Equal(message, json.RootElement.GetProperty("message").GetString());
        Assert.Equal(status, json.RootElement.GetProperty("transaction").GetProperty("status").GetString());
    }

    [Then("the refused request shows the transaction with the status of the request that succeeded")]
    public void ThenTheRefusedRequestShowsTheStatusOfTheRequestThatSucceeded()
    {
        var status = Succeeded.Request.ResultingStatus;
        using var json = JsonDocument.Parse(Refused.Body);
        Assert.Equal($"This transaction has already been {status.ToLowerInvariant()}.", json.RootElement.GetProperty("message").GetString());
        Assert.Equal(status, json.RootElement.GetProperty("transaction").GetProperty("status").GetString());
    }

    [Then("the transaction {string} is stored as {string}, last changed by the approver whose request succeeded")]
    public async Task ThenTheTransactionIsStoredAsLastChangedByTheWinner(string reference, string status)
    {
        var transaction = await TransactionValues.GetByReferenceAsync(reference);
        Assert.Equal(status, transaction.Status);
        Assert.Equal(await NameOfUserInBrowserAsync(Succeeded.Browser), transaction.LastChangedBy);
    }

    [Then("the transaction {string} is stored with the outcome of the request that succeeded")]
    public async Task ThenTheTransactionIsStoredWithTheOutcomeOfTheRequestThatSucceeded(string reference)
    {
        var winner = Succeeded;
        var transaction = await TransactionValues.GetByReferenceAsync(reference);
        Assert.Equal(winner.Request.ResultingStatus, transaction.Status);
        Assert.Equal(winner.Request.Reason, transaction.RejectionReason);
        Assert.Equal(await NameOfUserInBrowserAsync(winner.Browser), transaction.LastChangedBy);
    }

    [Then("either the approval stands and the cancel of {string} is refused, or the cancel succeeds and the approval is not found")]
    public async Task ThenEitherTheApprovalStandsOrTheCancelSucceeds(string fileName)
    {
        var approval = await FinishAsync(BrowserOf(RequestKind.Approve));
        var cancel = await FinishAsync(BrowserOf(RequestKind.Cancel));
        var fileId = fileSeeder.GetFileId(fileName);
        var transactions = await TestDatabase.GetTransactionsAsync(fileId);
        var isCancelled = await TestDatabase.IsFileCancelledAsync(fileId);

        if (approval.Response.StatusCode == HttpStatusCode.OK)
        {
            Assert.Equal(HttpStatusCode.Conflict, cancel.Response.StatusCode);
            Assert.False(isCancelled);
            Assert.Equal("Approved", Assert.Single(transactions).Status);
        }
        else
        {
            Assert.Equal(HttpStatusCode.NotFound, approval.Response.StatusCode);
            Assert.Equal(HttpStatusCode.OK, cancel.Response.StatusCode);
            Assert.True(isCancelled);
            Assert.Empty(transactions);
        }
    }

    [Then("no cancelled file has an approved transaction")]
    public async Task ThenNoCancelledFileHasAnApprovedTransaction()
    {
        Assert.Equal(0, await TestDatabase.CountApprovedTransactionsOfCancelledFilesAsync());
    }

    [Then("the file {string} is not cancelled")]
    public async Task ThenTheFileIsNotCancelled(string fileName)
    {
        Assert.False(await TestDatabase.IsFileCancelledAsync(fileSeeder.GetFileId(fileName)));
    }

    private void Start(string browser, RequestKind kind, Func<Task<HttpResponseMessage>> send, string? reason = null)
    {
        _requests[browser] = new StartedRequest(kind, reason, Task.Run(send));
    }

    private async Task<FinishedRequest> FinishAsync(string browser)
    {
        if (_finished.TryGetValue(browser, out var finished))
        {
            return finished;
        }
        var request = _requests.TryGetValue(browser, out var started)
            ? started
            : throw new InvalidOperationException($"No request was started in browser \"{browser}\".");
        var response = await request.Sending.WaitAsync(FinishTimeout);
        return _finished[browser] = new FinishedRequest(browser, request, response, await response.Content.ReadAsStringAsync());
    }

    private FinishedRequest Succeeded => FinishedWith(HttpStatusCode.OK);

    private FinishedRequest Refused => FinishedWith(HttpStatusCode.Conflict);

    /// <summary>The only finished request with the status code.</summary>
    private FinishedRequest FinishedWith(HttpStatusCode statusCode) =>
        Assert.Single(_finished.Values, request => request.Response.StatusCode == statusCode);

    private string BrowserOf(RequestKind kind) => _requests.Single(request => request.Value.Kind == kind).Key;

    private async Task<string> NameOfUserInBrowserAsync(string browser)
    {
        var response = await api.SendAsync(HttpMethod.Get, "auth/me", sessionCookie: state.GetBrowserSessionCookie(browser));
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("name").GetString()!;
    }

    private enum RequestKind
    {
        Approve,
        Reject,
        Cancel,
    }

    private sealed record StartedRequest(RequestKind Kind, string? Reason, Task<HttpResponseMessage> Sending)
    {
        /// <summary>The transaction status the request leads to when it succeeds.</summary>
        public string ResultingStatus => Kind == RequestKind.Reject ? "Rejected" : "Approved";
    }

    private sealed record FinishedRequest(string Browser, StartedRequest Request, HttpResponseMessage Response, string Body);
}
