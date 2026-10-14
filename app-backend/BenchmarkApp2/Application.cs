using BenchmarkApp2.Database;

namespace BenchmarkApp2;

internal sealed class Application(
    Migrator migrator,
    Services.TransactionApi.Service transactionApi,
    Services.FileProcessor.Service fileProcessor,
    ILogger<Application> logger) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await migrator.MigrateAsync(cancellationToken);
        await fileProcessor.StartAsync(cancellationToken);
        await transactionApi.StartAsync(cancellationToken);
        logger.LogInformation("Application started.");
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        logger.LogInformation("Application stopping.");
        await transactionApi.StopAsync(cancellationToken);
        await fileProcessor.StopAsync(cancellationToken);
    }
}
