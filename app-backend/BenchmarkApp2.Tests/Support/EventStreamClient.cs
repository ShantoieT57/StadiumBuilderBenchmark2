using System.Text.Json;

namespace BenchmarkApp2.Tests.Support;

/// <summary>One message read from a Server-Sent Events stream: an event, or a comment line such as a heartbeat.</summary>
public sealed record ServerSentMessage(string? Id, string? Event, string? Data, string? Comment)
{
    public bool IsHeartbeat => Comment == "heartbeat";

    /// <summary>The event's JSON data. Only for an event, never a comment.</summary>
    public JsonElement ReadData()
    {
        using var json = JsonDocument.Parse(Data ?? throw new InvalidOperationException("The message is not an event."));
        return json.RootElement.Clone();
    }
}

/// <summary>
/// Reads an open <c>text/event-stream</c> response in the background, as a browser's EventSource
/// would, and keeps every event and comment in the order it arrived. Waiting for messages fails the
/// scenario after <see cref="Timeout"/>, or straight away once the server has closed the stream.
/// </summary>
public sealed class EventStreamClient : IAsyncDisposable
{
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(15);

    private readonly CancellationTokenSource _closing = new();
    private readonly List<ServerSentMessage> _messages = [];
    private readonly Lock _lock = new();
    private readonly Task _reading;
    private TaskCompletionSource _arrived = NewSignal();
    private bool _isClosed;

    public EventStreamClient(HttpResponseMessage response)
    {
        Response = response;
        _reading = Task.Run(ReadAsync);
    }

    public HttpResponseMessage Response { get; }

    /// <summary>Every message received so far, in order.</summary>
    public IReadOnlyList<ServerSentMessage> Messages
    {
        get
        {
            lock (_lock)
            {
                return [.. _messages];
            }
        }
    }

    /// <summary>Every event (not comment) received so far, in order.</summary>
    public IReadOnlyList<ServerSentMessage> Events => [.. Messages.Where(message => message.Event is not null)];

    /// <summary>
    /// Waits until the messages received so far satisfy the condition, failing if the stream closes
    /// or the timeout passes first.
    /// </summary>
    public async Task WaitUntilAsync(Func<IReadOnlyList<ServerSentMessage>, bool> isSatisfied, string description)
    {
        using var timeout = new CancellationTokenSource(Timeout);
        while (true)
        {
            Task arrived;
            bool isClosed;
            lock (_lock)
            {
                if (isSatisfied(_messages))
                {
                    return;
                }
                (arrived, isClosed) = (_arrived.Task, _isClosed);
            }

            Assert.False(isClosed, $"The event stream closed before it sent {description}.");
            try
            {
                await arrived.WaitAsync(timeout.Token);
            }
            catch (OperationCanceledException) when (timeout.IsCancellationRequested)
            {
                Assert.Fail($"The event stream had not sent {description} after {Timeout.TotalSeconds} seconds.");
            }
        }
    }

    /// <summary>Waits for the server to close the stream, and returns every message it sent.</summary>
    public async Task<IReadOnlyList<ServerSentMessage>> WaitForCloseAsync()
    {
        try
        {
            await _reading.WaitAsync(Timeout);
        }
        catch (TimeoutException)
        {
            Assert.Fail($"The event stream was still open after {Timeout.TotalSeconds} seconds.");
        }
        return Messages;
    }

    private async Task ReadAsync()
    {
        try
        {
            await using var body = await Response.Content.ReadAsStreamAsync(_closing.Token);
            using var reader = new StreamReader(body);
            string? id = null, eventType = null;
            var data = new List<string>();
            while (await reader.ReadLineAsync(_closing.Token) is { } line)
            {
                if (line.Length == 0)
                {
                    if (eventType is not null || data.Count > 0)
                    {
                        Receive(new ServerSentMessage(id, eventType ?? "message", string.Join('\n', data), null));
                    }
                    (id, eventType) = (null, null);
                    data.Clear();
                }
                else if (line.StartsWith(':'))
                {
                    Receive(new ServerSentMessage(null, null, null, line[1..].TrimStart()));
                }
                else
                {
                    var separator = line.IndexOf(':');
                    var field = separator < 0 ? line : line[..separator];
                    var value = separator < 0 ? string.Empty : line[(separator + 1)..];
                    value = value.StartsWith(' ') ? value[1..] : value;
                    switch (field)
                    {
                        case "id": id = value; break;
                        case "event": eventType = value; break;
                        case "data": data.Add(value); break;
                    }
                }
            }
        }
        catch (Exception) when (_closing.IsCancellationRequested)
        {
            // Closed by the scenario.
        }
        catch (IOException)
        {
            // The server aborted the stream; treated as closed.
        }
        finally
        {
            lock (_lock)
            {
                _isClosed = true;
                _arrived.TrySetResult();
            }
        }
    }

    private void Receive(ServerSentMessage message)
    {
        lock (_lock)
        {
            _messages.Add(message);
            _arrived.TrySetResult();
            _arrived = NewSignal();
        }
    }

    private static TaskCompletionSource NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>Closes the stream from the client's side, as a browser does when the page is closed.</summary>
    public async ValueTask DisposeAsync()
    {
        await _closing.CancelAsync();
        Response.Dispose();
        await _reading;
        _closing.Dispose();
    }
}
