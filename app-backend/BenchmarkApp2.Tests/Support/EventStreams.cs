namespace BenchmarkApp2.Tests.Support;

/// <summary>
/// The event streams a scenario has open, by browser. The stream opened with the scenario's own
/// session cookie has no browser name. Every stream still open is closed when the scenario ends.
/// </summary>
public sealed class EventStreams : IAsyncDisposable
{
    private const string OwnStream = "";

    private readonly Dictionary<string, EventStreamClient> _streams = [];

    public void Add(string? browser, EventStreamClient stream) => _streams[browser ?? OwnStream] = stream;

    public EventStreamClient Get(string? browser) =>
        _streams.TryGetValue(browser ?? OwnStream, out var stream)
            ? stream
            : throw new InvalidOperationException(browser is null
                ? "No event stream has been opened in this scenario."
                : $"No event stream has been opened in browser \"{browser}\" in this scenario.");

    public async Task CloseAsync(string? browser)
    {
        await Get(browser).DisposeAsync();
        _streams.Remove(browser ?? OwnStream);
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var stream in _streams.Values)
        {
            await stream.DisposeAsync();
        }
        _streams.Clear();
    }
}
