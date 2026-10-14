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

    /// <summary>The ids of the files uploaded in this scenario, in the order they were uploaded.</summary>
    public List<Guid> UploadedFileIds { get; } = [];

    public Guid LastUploadedFileId =>
        UploadedFileIds.Count > 0 ? UploadedFileIds[^1] : throw new InvalidOperationException("No file has been uploaded in this scenario.");

    /// <summary>The exact bytes of the files uploaded in this scenario, in the order they were uploaded.</summary>
    public List<byte[]> UploadedFileContents { get; } = [];

    public byte[] LastUploadedFileContent =>
        UploadedFileContents.Count > 0 ? UploadedFileContents[^1] : throw new InvalidOperationException("No file has been uploaded in this scenario.");

    /// <summary>The id of an uploaded file by its 1-based position in the order of uploads.</summary>
    public Guid GetUploadedFileId(int position) => UploadedFileIds[position - 1];

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
