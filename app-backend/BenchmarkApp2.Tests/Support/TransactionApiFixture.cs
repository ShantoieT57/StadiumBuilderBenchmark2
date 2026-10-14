using System.Net.Http.Json;
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

    public async Task<HttpResponseMessage> SendContentAsync(HttpMethod method, string relativePath, HttpContent? content, string? sessionCookie = null)
    {
        var client = await GetClientAsync();
        using var request = new HttpRequestMessage(method, relativePath);
        request.Content = content;
        if (sessionCookie is not null)
        {
            request.Headers.Add("Cookie", $"{SessionCookie.Name}={sessionCookie}");
        }
        return await client.SendAsync(request);
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

    public async ValueTask DisposeAsync()
    {
        _client?.Dispose();
        if (_app is not null)
        {
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
        if (_dataSource is not null)
        {
            await _dataSource.DisposeAsync();
        }
    }
}
