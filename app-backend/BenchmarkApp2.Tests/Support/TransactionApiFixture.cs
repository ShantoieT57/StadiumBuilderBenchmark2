using System.Net.Http.Json;
using System.Text;
using BenchmarkApp2.Services.TransactionApi;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace BenchmarkApp2.Tests.Support;

/// <summary>
/// Hosts the TransactionApi in memory (TestServer) against the test database for one scenario.
/// The host is built on first use so a scenario can choose the environment and settings beforehand.
/// The host reads the time from the scenario's <see cref="ManualTimeProvider"/>.
/// </summary>
public sealed class TransactionApiFixture(ManualTimeProvider clock) : IAsyncDisposable
{
    /// <summary>Includes a path so the runtime split into host URL and path base is exercised.</summary>
    private const string TransactionApiUri = "http://localhost:5100/api";

    private NpgsqlDataSource? _dataSource;
    private WebApplication? _app;
    private HttpClient? _client;

    public string EnvironmentName { get; set; } = "Test";

    /// <summary>The settings the host is built with; change them before the first request.</summary>
    public AppSettings Settings { get; } = new()
    {
        TransactionApiUri = TransactionApiUri,
        DatabaseConnectionString = TestDatabase.ConnectionString,
    };

    public Task<HttpResponseMessage> SendAsync(HttpMethod method, string relativePath, object? jsonBody = null, string? sessionCookie = null) =>
        SendContentAsync(method, relativePath, jsonBody is null ? null : JsonContent.Create(jsonBody), sessionCookie);

    /// <summary>Sends exactly this text as an <c>application/json</c> body, whether or not it is valid JSON.</summary>
    public Task<HttpResponseMessage> SendJsonTextAsync(HttpMethod method, string relativePath, string jsonText, string? sessionCookie = null) =>
        SendContentAsync(method, relativePath, new StringContent(jsonText, Encoding.UTF8, "application/json"), sessionCookie);

    public Task<HttpResponseMessage> SendContentAsync(HttpMethod method, string relativePath, HttpContent? content, string? sessionCookie = null) =>
        SendAsync(method, relativePath, content, sessionCookie, HttpCompletionOption.ResponseContentRead);

    /// <summary>
    /// Sends a GET and returns as soon as the response headers arrive, so a response that stays
    /// open (such as an event stream) can be read while the server is still writing it.
    /// </summary>
    public Task<HttpResponseMessage> OpenStreamAsync(string relativePath, string? sessionCookie) =>
        SendAsync(HttpMethod.Get, relativePath, content: null, sessionCookie, HttpCompletionOption.ResponseHeadersRead);

    /// <summary>A service from the running host, starting the host first if needed.</summary>
    public async Task<T> GetServiceAsync<T>() where T : notnull
    {
        await GetClientAsync();
        return _app!.Services.GetRequiredService<T>();
    }

    /// <summary>Stops the host, as the TransactionApi service's Stop does, but keeps the client so open responses can still be read.</summary>
    public async Task StopHostAsync()
    {
        if (_app is not null)
        {
            await _app.StopAsync();
        }
    }

    private async Task<HttpResponseMessage> SendAsync(
        HttpMethod method, string relativePath, HttpContent? content, string? sessionCookie, HttpCompletionOption completionOption)
    {
        var client = await GetClientAsync();
        using var request = new HttpRequestMessage(method, relativePath);
        request.Content = content;
        if (sessionCookie is not null)
        {
            request.Headers.Add("Cookie", $"{SessionCookie.Name}={sessionCookie}");
        }
        return await client.SendAsync(request, completionOption);
    }

    private async Task<HttpClient> GetClientAsync()
    {
        if (_client is not null)
        {
            return _client;
        }

        _dataSource = NpgsqlDataSource.Create(Settings.DatabaseConnectionString);
        _app = WebHostFactory.Create(Settings, EnvironmentName, _dataSource, builder =>
        {
            builder.WebHost.UseTestServer();
            builder.Services.AddSingleton<TimeProvider>(clock);
        });
        await _app.StartAsync();

        _client = _app.GetTestClient();
        _client.BaseAddress = new Uri(TransactionApiUri.TrimEnd('/') + "/");
        return _client;
    }

    /// <summary>Stops the host and releases its connections. Safe to call more than once.</summary>
    public async ValueTask DisposeAsync()
    {
        _client?.Dispose();
        _client = null;
        if (_app is not null)
        {
            await _app.StopAsync();
            await _app.DisposeAsync();
            _app = null;
        }
        if (_dataSource is not null)
        {
            await _dataSource.DisposeAsync();
            _dataSource = null;
        }
    }
}
