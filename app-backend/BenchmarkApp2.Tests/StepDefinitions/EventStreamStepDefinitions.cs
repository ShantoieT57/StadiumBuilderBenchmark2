using System.Globalization;
using System.Net;
using System.Text.Json;
using BenchmarkApp2.Data;
using BenchmarkApp2.Services.TransactionApi;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

/// <summary>
/// Steps for the event stream (GET /events). Events committed in one database transaction may
/// arrive in any order relative to events of other kinds, so the steps look for an event among
/// everything the stream has received, and check the order only of one file's file-changed events.
/// </summary>
[Binding]
public sealed class EventStreamStepDefinitions(
    TransactionApiFixture api,
    ApiScenarioState state,
    EventStreams streams,
    FileSeeder seeder)
{
    private const string EventsPath = "events";
    private const string FileChanged = "file-changed";
    private const string TransactionsChanged = "transactions-changed";
    private const string SessionEnded = "session-ended";
    private const string Resync = "resync";

    private static readonly TimeSpan ClientRemovalTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan ClientRemovalCheckInterval = TimeSpan.FromMilliseconds(50);

    private ChangeEventSubscription? _slowClient;
    private Guid _lastAnnouncedFileId;

    [Given("the event stream sends a heartbeat every {int} second(s)")]
    public void GivenTheEventStreamSendsAHeartbeatEvery(int seconds)
    {
        api.Settings.EventStreamHeartbeatSeconds = seconds;
    }

    [When("I open the event stream")]
    public Task WhenIOpenTheEventStream() => OpenAsync(browser: null, state.SessionCookie, requireOpen: false);

    [Given("I have opened the event stream")]
    public Task GivenIHaveOpenedTheEventStream() => OpenAsync(browser: null, state.SessionCookie, requireOpen: true);

    [Given("I have opened the event stream in browser {string}")]
    public Task GivenIHaveOpenedTheEventStreamInBrowser(string browser) =>
        OpenAsync(browser, state.GetBrowserSessionCookie(browser), requireOpen: true);

    [Then("the event stream is open with the content type {string}")]
    public void ThenTheEventStreamIsOpenWithTheContentType(string contentType)
    {
        var response = streams.Get(null).Response;
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(contentType, response.Content.Headers.ContentType?.MediaType);
    }

    /// <summary>Heartbeats already received are not counted, only those that arrive after this step starts.</summary>
    [Then("the event stream receives {int} more heartbeats")]
    public Task ThenTheEventStreamReceivesMoreHeartbeats(int count)
    {
        var stream = streams.Get(null);
        var expected = stream.Messages.Count(message => message.IsHeartbeat) + count;
        return stream.WaitUntilAsync(messages => messages.Count(message => message.IsHeartbeat) >= expected, $"{count} more heartbeats");
    }

    [Then("the event stream receives these file-changed events for the last uploaded file:")]
    public Task ThenTheEventStreamReceivesTheseFileChangedEvents(DataTable expected) =>
        WaitForFileChangesAsync(streams.Get(null), state.LastUploadedFileId, expected);

    [Then("the event stream in browser {string} receives these file-changed events for the last uploaded file:")]
    public Task ThenTheEventStreamInBrowserReceivesTheseFileChangedEvents(string browser, DataTable expected) =>
        WaitForFileChangesAsync(streams.Get(browser), state.LastUploadedFileId, expected);

    [Then("the event stream receives a transactions-changed event for the last uploaded file")]
    public Task ThenTheEventStreamReceivesATransactionsChangedEventForTheLastUploadedFile() =>
        WaitForTransactionsChangedAsync(state.LastUploadedFileId);

    [Then("the event stream receives a transactions-changed event for the file {string}")]
    public Task ThenTheEventStreamReceivesATransactionsChangedEventForTheFile(string fileName) =>
        WaitForTransactionsChangedAsync(seeder.GetFileId(fileName));

    [Then("the ids of the events received by the event stream increase")]
    public void ThenTheIdsOfTheEventsReceivedIncrease()
    {
        var ids = streams.Get(null).Events.Select(message => long.Parse(message.Id!, CultureInfo.InvariantCulture)).ToList();
        Assert.True(ids.Count > 1, "Fewer than two events were received.");
        Assert.Equal(ids.Order(), ids);
        Assert.Equal(ids.Distinct(), ids);
    }

    [Then("the event stream ends with a session-ended event with the reason {string} and the message {string}")]
    public Task ThenTheEventStreamEndsWithASessionEndedEvent(string reason, string message) =>
        AssertEndsWithSessionEndedAsync(streams.Get(null), reason, message);

    [Then("the event stream in browser {string} ends with a session-ended event with the reason {string} and the message {string}")]
    public Task ThenTheEventStreamInBrowserEndsWithASessionEndedEvent(string browser, string reason, string message) =>
        AssertEndsWithSessionEndedAsync(streams.Get(browser), reason, message);

    [Then("the event stream ends without a session-ended event")]
    public async Task ThenTheEventStreamEndsWithoutASessionEndedEvent()
    {
        var messages = await streams.Get(null).WaitForCloseAsync();
        Assert.DoesNotContain(messages, message => message.Event == SessionEnded);
    }

    [Given("{int} client(s) is/are connected to the event stream")]
    public async Task GivenClientsAreConnectedToTheEventStream(int count)
    {
        Assert.Equal(count, (await api.GetServiceAsync<ChangeEventHub>()).ClientCount);
    }

    [When("I close the event stream")]
    public Task WhenICloseTheEventStream() => streams.CloseAsync(null);

    [Then("soon no client is connected to the event stream")]
    public async Task ThenSoonNoClientIsConnectedToTheEventStream()
    {
        var hub = await api.GetServiceAsync<ChangeEventHub>();
        using var timeout = new CancellationTokenSource(ClientRemovalTimeout);
        while (hub.ClientCount > 0)
        {
            Assert.False(timeout.IsCancellationRequested, $"{hub.ClientCount} client(s) were still connected after {ClientRemovalTimeout.TotalSeconds} seconds.");
            await Task.Delay(ClientRemovalCheckInterval);
        }
    }

    [When("the TransactionApi host stops")]
    public Task WhenTheTransactionApiHostStops() => api.StopHostAsync();

    [Given("a client that never reads its events is connected")]
    public async Task GivenAClientThatNeverReadsItsEventsIsConnected()
    {
        _slowClient = (await api.GetServiceAsync<ChangeEventHub>()).Subscribe();
    }

    [When("{int} batches of {int} changes are announced, each received by the event stream before the next")]
    public async Task WhenBatchesOfChangesAreAnnounced(int batchCount, int batchSize)
    {
        for (var batch = 0; batch < batchCount; batch++)
        {
            var fileIds = NewFileIds(batchSize);
            await AnnounceFileChangesAsync(fileIds);
            await streams.Get(null).WaitUntilAsync(
                messages => fileIds.IsSubsetOf(FileChanges(messages).Select(change => change.FileId)),
                $"the {batchSize} changes of batch {batch + 1}");
        }
    }

    [When("{int} more change(s) is/are announced")]
    public async Task WhenMoreChangesAreAnnounced(int count)
    {
        var fileIds = NewFileIds(count);
        await AnnounceFileChangesAsync(fileIds);
        _lastAnnouncedFileId = fileIds.Last();
    }

    [Then("the client that never reads its events is still connected")]
    public void ThenTheClientThatNeverReadsItsEventsIsStillConnected()
    {
        Assert.False(SlowClient.IsClosed);
    }

    /// <summary>
    /// A change is handed to every client at the same moment, so once the reading client has the
    /// last change, the slow client has been dealt with too.
    /// </summary>
    [Then("the client that never reads its events has been disconnected")]
    public async Task ThenTheClientThatNeverReadsItsEventsHasBeenDisconnected()
    {
        await ThenTheEventStreamReceivesThatChange();
        Assert.True(SlowClient.IsClosed);
    }

    [Then("the event stream receives that change")]
    public Task ThenTheEventStreamReceivesThatChange() =>
        streams.Get(null).WaitUntilAsync(
            messages => FileChanges(messages).Any(change => change.FileId == _lastAnnouncedFileId),
            $"the {FileChanged} event for the file {_lastAnnouncedFileId}");

    [When("the change listener's database connection drops")]
    public async Task WhenTheChangeListenersDatabaseConnectionDrops()
    {
        Assert.True(await TestDatabase.TerminateConnectionsAsync(ChangeNotificationListener.ApplicationName) > 0);
    }

    [Then("the event stream receives a resync event")]
    public async Task ThenTheEventStreamReceivesAResyncEvent()
    {
        var stream = streams.Get(null);
        await stream.WaitUntilAsync(messages => messages.Any(message => message.Event == Resync), $"a {Resync} event");
        Assert.Equal(JsonValueKind.Object, stream.Events.First(message => message.Event == Resync).ReadData().ValueKind);
    }

    private ChangeEventSubscription SlowClient =>
        _slowClient ?? throw new InvalidOperationException("No client that never reads its events is connected.");

    private async Task OpenAsync(string? browser, string? sessionCookie, bool requireOpen)
    {
        var response = await api.OpenStreamAsync(EventsPath, sessionCookie);
        if (response.StatusCode != HttpStatusCode.OK)
        {
            await state.RecordResponseAsync(response);
            Assert.False(requireOpen, $"The event stream did not open: {(int)response.StatusCode} {state.LastResponseBody}");
            return;
        }
        streams.Add(browser, new EventStreamClient(response));
    }

    /// <summary>Waits until the file's file-changed events include the expected ones, in the expected order.</summary>
    private static Task WaitForFileChangesAsync(EventStreamClient stream, Guid fileId, DataTable expected)
    {
        var expectedChanges = expected.Rows.Select(row => (Status: row["status"], IsCancelled: bool.Parse(row["isCancelled"]))).ToList();
        return stream.WaitUntilAsync(
            messages => IsInOrderWithin(
                expectedChanges,
                FileChanges(messages).Where(change => change.FileId == fileId).Select(change => (change.Status, change.IsCancelled)).ToList()),
            $"the {FileChanged} events {string.Join(", ", expectedChanges)} for the file {fileId}");
    }

    private Task WaitForTransactionsChangedAsync(Guid fileId) =>
        streams.Get(null).WaitUntilAsync(
            messages => messages.Any(message => message.Event == TransactionsChanged && message.ReadData().GetProperty("fileId").GetGuid() == fileId),
            $"a {TransactionsChanged} event for the file {fileId}");

    private static async Task AssertEndsWithSessionEndedAsync(EventStreamClient stream, string reason, string message)
    {
        var messages = await stream.WaitForCloseAsync();
        Assert.NotEmpty(messages);
        var last = messages[^1];
        Assert.Equal(SessionEnded, last.Event);
        var data = last.ReadData();
        Assert.Equal((reason, message), (data.GetProperty("reason").GetString(), data.GetProperty("message").GetString()));
    }

    private static IEnumerable<(Guid FileId, string Status, bool IsCancelled)> FileChanges(IEnumerable<ServerSentMessage> messages) =>
        messages
            .Where(message => message.Event == FileChanged)
            .Select(message => message.ReadData())
            .Select(data => (data.GetProperty("fileId").GetGuid(), data.GetProperty("status").GetString()!, data.GetProperty("isCancelled").GetBoolean()));

    /// <summary>Whether every expected item appears in the actual items, in the same order (other items may come in between).</summary>
    private static bool IsInOrderWithin<T>(IReadOnlyList<T> expected, IReadOnlyList<T> actual)
    {
        var matched = 0;
        foreach (var item in actual)
        {
            if (matched < expected.Count && EqualityComparer<T>.Default.Equals(item, expected[matched]))
            {
                matched++;
            }
        }
        return matched == expected.Count;
    }

    private static HashSet<Guid> NewFileIds(int count) => [.. Enumerable.Range(0, count).Select(_ => Guid.NewGuid())];

    private static Task AnnounceFileChangesAsync(IEnumerable<Guid> fileIds) =>
        TestDatabase.NotifyAsync(
            ChangeNotificationListener.Channel,
            fileIds.Select(fileId => JsonSerializer.Serialize(new
            {
                type = FileChanged,
                data = new { fileId, status = "Uploaded", isCancelled = false },
            })));
}
