using Npgsql;
using Twenty57.Builder.ApplicationRuntime.Interfaces;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Hosts the TransactionApi REST API, which can be started and stopped independently. The host
/// includes the live event stream's <see cref="ChangeEventRelay"/>, which listens for database
/// changes while the host runs; stopping the host closes every open event stream.
/// </summary>
public sealed class Service(
    AppSettings settings,
    IHostEnvironment environment,
    NpgsqlDataSource dataSource,
    ILogger<Service> logger) : IService
{
    private readonly SemaphoreSlim _lock = new(1, 1);
    private WebApplication? _app;

    public bool IsRunning => _app is not null;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            if (_app is not null)
            {
                return;
            }

            var app = WebHostFactory.Create(settings, environment.EnvironmentName, dataSource);
            await app.StartAsync(cancellationToken);
            _app = app;
            logger.LogInformation("TransactionApi started at {TransactionApiUri}.", settings.TransactionApiUri);
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            if (_app is null)
            {
                return;
            }

            await _app.StopAsync(cancellationToken);
            await _app.DisposeAsync();
            _app = null;
            logger.LogInformation("TransactionApi stopped.");
        }
        finally
        {
            _lock.Release();
        }
    }
}
