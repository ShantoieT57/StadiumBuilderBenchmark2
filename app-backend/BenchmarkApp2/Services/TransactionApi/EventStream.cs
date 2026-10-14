using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Writes the live event stream (GET /events) to one signed-in client as Server-Sent Events: every
/// change event from the <see cref="ChangeEventHub"/>, and a heartbeat comment every
/// <see cref="AppSettings.EventStreamHeartbeatSeconds"/>. The session is checked at each heartbeat
/// without counting as activity (SI-06); once it has ended, a final <c>session-ended</c> event
/// says why, with the same reason and message a 401 gives, and the stream closes. The stream also
/// closes when the client disconnects, falls too far behind, or the host stops.
/// </summary>
public sealed class EventStream(
    ChangeEventHub hub,
    SessionManager sessionManager,
    AppSettings settings,
    TimeProvider timeProvider,
    ILogger<EventStream> logger)
{
    public const string ContentType = "text/event-stream";
    public const string SessionEndedEventType = "session-ended";

    /// <summary>How long a client waits before reconnecting after the stream closes, in milliseconds.</summary>
    private const int ReconnectDelayMilliseconds = 5000;

    private const string Heartbeat = ": heartbeat\n\n";

    public async Task WriteAsync(HttpResponse response, string sessionToken, CancellationToken cancellationToken)
    {
        using var subscription = hub.Subscribe();
        using var heartbeat = new PeriodicTimer(TimeSpan.FromSeconds(settings.EventStreamHeartbeatSeconds), timeProvider);

        response.StatusCode = StatusCodes.Status200OK;
        response.ContentType = ContentType;
        response.Headers.CacheControl = "no-cache";
        response.Headers["X-Accel-Buffering"] = "no";
        response.HttpContext.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();

        try
        {
            await SendAsync(response, $"retry: {ReconnectDelayMilliseconds}\n\n", cancellationToken);

            var nextEvent = subscription.Events.WaitToReadAsync(cancellationToken).AsTask();
            var nextHeartbeat = heartbeat.WaitForNextTickAsync(cancellationToken).AsTask();
            while (true)
            {
                if (await Task.WhenAny(nextEvent, nextHeartbeat) == nextEvent)
                {
                    if (!await nextEvent)
                    {
                        return;
                    }
                    var events = new StringBuilder();
                    while (subscription.Events.TryRead(out var changeEvent))
                    {
                        events.Append(Format(changeEvent));
                    }
                    await SendAsync(response, events.ToString(), cancellationToken);
                    nextEvent = subscription.Events.WaitToReadAsync(cancellationToken).AsTask();
                }
                else
                {
                    await nextHeartbeat;
                    var session = await sessionManager.AuthenticateAsync(sessionToken, countsAsActivity: false, cancellationToken);
                    if (session.User is null)
                    {
                        await SendAsync(response, Format(SessionEnded(session.FailureReason)), cancellationToken);
                        return;
                    }
                    await SendAsync(response, Heartbeat, cancellationToken);
                    nextHeartbeat = heartbeat.WaitForNextTickAsync(cancellationToken).AsTask();
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // The client disconnected.
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // The client reconnects and re-fetches, so ending the stream is enough.
            logger.LogWarning(exception, "The event stream failed and was closed.");
        }
    }

    private ChangeEvent SessionEnded(UnauthenticatedReason reason) => new(
        hub.NextEventId(),
        SessionEndedEventType,
        JsonSerializer.Serialize(new SessionEndedEvent { Reason = reason, Message = sessionManager.DescribeUnauthenticated(reason) }));

    private static string Format(ChangeEvent changeEvent) =>
        $"id: {changeEvent.Id}\nevent: {changeEvent.Type}\ndata: {changeEvent.Data}\n\n";

    private static async Task SendAsync(HttpResponse response, string text, CancellationToken cancellationToken)
    {
        await response.WriteAsync(text, cancellationToken);
        await response.Body.FlushAsync(cancellationToken);
    }
}
