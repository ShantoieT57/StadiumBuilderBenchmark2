using System.Text.Json;
using BenchmarkApp2.Data;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Relays the database's change notifications to the event-stream clients through the
/// <see cref="ChangeEventHub"/>, over one listening connection however many clients are connected.
/// </summary>
/// <remarks>
/// <para>
/// This is part of the TransactionApi service, not a service of its own: it runs as a hosted service
/// inside the TransactionApi web application, so it starts and stops with the REST host. Its only
/// consumers are the event streams that host serves, so running it without the host would have
/// nobody to tell, and running the host without it would leave streams open that silently never
/// announce anything.
/// </para>
/// <para>
/// Starting waits until the connection is listening (or the first attempt has failed), so a change
/// committed once the host has started is never missed. A lost connection is retried, waiting
/// longer after each failure up to <see cref="MaxRetryDelay"/>; once listening again, a
/// <c>resync</c> event tells every client that changes may have been missed. When the host is
/// stopping, every stream is closed first, so the host never waits for open streams.
/// </para>
/// </remarks>
public sealed class ChangeEventRelay(ChangeNotificationListener listener, ChangeEventHub hub, ILogger<ChangeEventRelay> logger)
    : IHostedLifecycleService
{
    public const string ResyncEventType = "resync";

    private static readonly TimeSpan FirstRetryDelay = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan MaxRetryDelay = TimeSpan.FromSeconds(30);

    private readonly CancellationTokenSource _stopping = new();
    private Task? _running;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var firstAttempt = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _running = Task.Run(() => RunAsync(firstAttempt, _stopping.Token), CancellationToken.None);
        await firstAttempt.Task.WaitAsync(cancellationToken);
    }

    /// <summary>Closes every stream before the host stops, so the host does not wait for them.</summary>
    public Task StoppingAsync(CancellationToken cancellationToken)
    {
        hub.CloseAll();
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        await _stopping.CancelAsync();
        if (_running is not null)
        {
            await _running.WaitAsync(cancellationToken);
        }
    }

    public Task StartingAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public Task StartedAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public Task StoppedAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private async Task RunAsync(TaskCompletionSource firstAttempt, CancellationToken stoppingToken)
    {
        var retryDelay = FirstRetryDelay;
        var hasListened = false;
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await listener.ListenAsync(Relay, OnListening, stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    return;
                }
                catch (Exception exception)
                {
                    firstAttempt.TrySetResult();
                    logger.LogWarning(exception, "Listening for database changes failed; retrying in {RetryDelay}.", retryDelay);
                    await Task.Delay(retryDelay, stoppingToken);
                    retryDelay = TimeSpan.FromTicks(Math.Min(retryDelay.Ticks * 2, MaxRetryDelay.Ticks));
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        finally
        {
            firstAttempt.TrySetResult();
        }

        void OnListening()
        {
            if (hasListened)
            {
                logger.LogInformation("Listening for database changes again; telling clients to re-fetch.");
                hub.Publish(ResyncEventType, "{}");
            }
            hasListened = true;
            retryDelay = FirstRetryDelay;
            firstAttempt.TrySetResult();
        }
    }

    private void Relay(string payload)
    {
        if (TryReadNotification(payload) is { } notification)
        {
            hub.Publish(notification.Type, notification.Data);
        }
        else
        {
            logger.LogWarning("Ignored a change notification that is not {{\"type\": ..., \"data\": {{...}}}}: {Payload}", payload);
        }
    }

    /// <summary>
    /// Reads a notification of the form <c>{"type": "file-changed", "data": {...}}</c>. The type must
    /// be lower-case letters and hyphens, and the data is re-written as compact JSON, so neither can
    /// break the event-stream format.
    /// </summary>
    private static (string Type, string Data)? TryReadNotification(string payload)
    {
        try
        {
            using var json = JsonDocument.Parse(payload);
            var root = json.RootElement;
            if (root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("type", out var type) && type.GetString() is { Length: > 0 } typeName
                && typeName.All(character => character is (>= 'a' and <= 'z') or '-')
                && root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Object)
            {
                return (typeName, JsonSerializer.Serialize(data));
            }
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException)
        {
        }
        return null;
    }
}
