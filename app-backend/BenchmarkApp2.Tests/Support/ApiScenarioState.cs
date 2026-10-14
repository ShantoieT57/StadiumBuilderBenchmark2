using BenchmarkApp2.Services.TransactionApi;

namespace BenchmarkApp2.Tests.Support;

/// <summary>State shared between the step definition classes within one scenario.</summary>
public sealed class ApiScenarioState
{
    private HttpResponseMessage? _lastResponse;

    public HttpResponseMessage LastResponse =>
        _lastResponse ?? throw new InvalidOperationException("No request has been sent in this scenario.");

    public string LastResponseBody { get; private set; } = string.Empty;

    /// <summary>The session cookie value sent with authenticated requests, if any.</summary>
    public string? SessionCookie { get; set; }

    /// <summary>
    /// Session cookies held by separately named browsers (or devices), for scenarios in which the
    /// same or different people are signed in in more than one place.
    /// </summary>
    public Dictionary<string, string> BrowserSessionCookies { get; } = [];

    public string GetBrowserSessionCookie(string browser) =>
        BrowserSessionCookies.TryGetValue(browser, out var cookie)
            ? cookie
            : throw new InvalidOperationException($"Browser \"{browser}\" has no session cookie in this scenario.");

    public async Task RecordResponseAsync(HttpResponseMessage response)
    {
        _lastResponse = response;
        LastResponseBody = await response.Content.ReadAsStringAsync();
    }

    /// <summary>The Set-Cookie header the last response issued for the session cookie, if any.</summary>
    public string? IssuedSessionCookieHeader =>
        LastResponse.Headers.TryGetValues("Set-Cookie", out var values)
            ? values.FirstOrDefault(value => value.StartsWith($"{Services.TransactionApi.SessionCookie.Name}=", StringComparison.Ordinal))
            : null;

    /// <summary>The value of the session cookie issued by the last response, if any.</summary>
    public string? IssuedSessionCookieValue => IssuedSessionCookieHeader?.Split(';')[0].Split('=', 2)[1];
}
