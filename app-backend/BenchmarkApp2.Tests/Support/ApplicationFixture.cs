using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.Internal;
using Microsoft.Extensions.Logging;

namespace BenchmarkApp2.Tests.Support;

/// <summary>
/// Builds the whole application (migrator, TransactionApi and file processor) from the scenario's
/// settings with the same registrations as Program.cs, so a scenario can start it and see what
/// starts. Messages the application logs are kept in <see cref="Log"/>.
/// </summary>
public sealed class ApplicationFixture : IAsyncDisposable
{
    /// <summary>
    /// A path is included as in the default; port 0 lets the listener take any free port, so the real
    /// REST host can start alongside a running copy of the application.
    /// </summary>
    private const string FreePortTransactionApiUri = "http://127.0.0.1:0/api";

    private ServiceProvider? _services;
    private Application? _application;

    /// <summary>The settings the application is built with; change them before it is first used.</summary>
    public AppSettings Settings { get; } = new()
    {
        TransactionApiUri = FreePortTransactionApiUri,
        DatabaseConnectionString = TestDatabase.ConnectionString,
    };

    public CapturingLoggerProvider Log { get; } = new();

    public Application Application => _application ??= Services.GetServices<IHostedService>().OfType<Application>().Single();

    /// <summary>The TransactionApi service, or null when the application never created it.</summary>
    public BenchmarkApp2.Services.TransactionApi.Service? TransactionApi { get; private set; }

    /// <summary>The file processor service, or null when the application never created it.</summary>
    public BenchmarkApp2.Services.FileProcessor.Service? FileProcessor { get; private set; }

    /// <remarks>
    /// The services are registered again, last so they win, only to record each instance when the
    /// application creates it; checking them never creates them (or the data source) itself.
    /// </remarks>
    private ServiceProvider Services => _services ??= new ServiceCollection()
        .AddLogging(logging => logging.AddProvider(Log))
        .AddSingleton<IHostEnvironment>(new HostingEnvironment { EnvironmentName = "Test" })
        .AddApplication(Settings)
        .AddSingleton(provider => TransactionApi = ActivatorUtilities.CreateInstance<BenchmarkApp2.Services.TransactionApi.Service>(provider))
        .AddSingleton(provider => FileProcessor = ActivatorUtilities.CreateInstance<BenchmarkApp2.Services.FileProcessor.Service>(provider))
        .BuildServiceProvider();

    /// <summary>Stops whatever the application started and releases its connections. Safe to call more than once.</summary>
    public async ValueTask DisposeAsync()
    {
        if (_application is not null)
        {
            await _application.StopAsync(CancellationToken.None);
            _application = null;
        }
        if (_services is not null)
        {
            await _services.DisposeAsync();
            _services = null;
        }
    }
}
