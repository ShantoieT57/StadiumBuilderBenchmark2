using System.Collections.Concurrent;
using System.Threading.Channels;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>An event for the event stream: its id, its type (the SSE event name) and its data, one line of JSON.</summary>
public sealed record ChangeEvent(long Id, string Type, string Data);

/// <summary>
/// Hands every change event to every connected event-stream client. Each client has its own bounded
/// buffer, so a client that reads slowly never holds up the others: a client whose buffer is full
/// is disconnected (its stream ends and it reconnects), rather than holding events for it or
/// waiting for it. Event ids increase across every event the hub hands out.
/// </summary>
public sealed class ChangeEventHub
{
    /// <summary>How many events a client may fall behind by before it is disconnected.</summary>
    public const int ClientBufferCapacity = 256;

    private readonly ConcurrentDictionary<ChangeEventSubscription, byte> _subscriptions = new();
    private long _lastEventId;
    private volatile bool _isClosed;

    /// <summary>How many clients are connected.</summary>
    public int ClientCount => _subscriptions.Count;

    /// <summary>
    /// Connects a client. Once the hub is closed, the subscription is closed straight away. Dispose
    /// the subscription to disconnect.
    /// </summary>
    public ChangeEventSubscription Subscribe()
    {
        var subscription = new ChangeEventSubscription(this);
        _subscriptions.TryAdd(subscription, 0);
        if (_isClosed)
        {
            Unsubscribe(subscription);
        }
        return subscription;
    }

    /// <summary>The next event id; also used for an event sent to a single client.</summary>
    public long NextEventId() => Interlocked.Increment(ref _lastEventId);

    /// <summary>Hands an event to every connected client, disconnecting any client whose buffer is full.</summary>
    public void Publish(string type, string data)
    {
        var changeEvent = new ChangeEvent(NextEventId(), type, data);
        foreach (var subscription in _subscriptions.Keys)
        {
            if (!subscription.TryWrite(changeEvent))
            {
                Unsubscribe(subscription);
            }
        }
    }

    /// <summary>Disconnects every client and every client that connects later, ending their streams.</summary>
    public void CloseAll()
    {
        _isClosed = true;
        foreach (var subscription in _subscriptions.Keys)
        {
            Unsubscribe(subscription);
        }
    }

    internal void Unsubscribe(ChangeEventSubscription subscription)
    {
        if (_subscriptions.TryRemove(subscription, out _))
        {
            subscription.Close();
        }
    }
}

/// <summary>
/// One client's connection to the <see cref="ChangeEventHub"/>: the events waiting to be sent to it.
/// Once closed, the events still buffered can be read, and then <see cref="Events"/> completes.
/// </summary>
public sealed class ChangeEventSubscription : IDisposable
{
    private readonly ChangeEventHub _hub;
    private readonly Channel<ChangeEvent> _events = Channel.CreateBounded<ChangeEvent>(
        new BoundedChannelOptions(ChangeEventHub.ClientBufferCapacity)
        {
            SingleReader = true,
            FullMode = BoundedChannelFullMode.Wait,
        });
    private volatile bool _isClosed;

    internal ChangeEventSubscription(ChangeEventHub hub) => _hub = hub;

    public ChannelReader<ChangeEvent> Events => _events.Reader;

    /// <summary>Whether the client has been disconnected: by itself, for falling behind, or because the hub closed.</summary>
    public bool IsClosed => _isClosed;

    /// <summary>Buffers the event, or returns false when the buffer is full or the subscription is closed.</summary>
    internal bool TryWrite(ChangeEvent changeEvent) => _events.Writer.TryWrite(changeEvent);

    internal void Close()
    {
        _isClosed = true;
        _events.Writer.TryComplete();
    }

    public void Dispose() => _hub.Unsubscribe(this);
}
