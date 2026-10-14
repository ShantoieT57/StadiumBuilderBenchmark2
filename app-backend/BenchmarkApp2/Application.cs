using BenchmarkApp2.Database;

namespace BenchmarkApp2;

/// <summary>
/// Starts the application: checks the settings, migrates the database, then starts the services.
/// Invalid settings stop startup before anything else runs (see <see cref="AppSettingsValidator"/>).
/// </summary>
/// <remarks>
/// The migrator and services are resolved only once the settings are valid, because creating them
/// creates the database data source, which fails on its own, less clearly, for some invalid settings
/// (e.g. an empty connection string).
/// </remarks>
public sealed class Application(AppSettings settings, IServiceProvider services, ILogger<Application> logger) : IHostedService
{
    private Services.TransactionApi.Service? _transactionApi;
    private Services.FileProcessor.Service? _fileProcessor;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            AppSettingsValidator.ThrowIfInvalid(settings);
        }
        catch (InvalidAppSettingsException exception)
        {
            logger.LogCritical("{Message}", exception.Message);
            throw;
        }

        await services.GetRequiredService<Migrator>().MigrateAsync(cancellationToken);
        _fileProcessor = services.GetRequiredService<Services.FileProcessor.Service>();
        await _fileProcessor.StartAsync(cancellationToken);
        _transactionApi = services.GetRequiredService<Services.TransactionApi.Service>();
        await _transactionApi.StartAsync(cancellationToken);
        logger.LogInformation("Application started.");
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        logger.LogInformation("Application stopping.");
        if (_transactionApi is not null)
        {
            await _transactionApi.StopAsync(cancellationToken);
        }
        if (_fileProcessor is not null)
        {
            await _fileProcessor.StopAsync(cancellationToken);
        }
    }
}
