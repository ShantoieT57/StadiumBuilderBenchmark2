namespace BenchmarkApp2;

internal sealed class Application(ILogger<Application> logger) : IHostedService
{
    private readonly ILogger<Application> _logger = logger;

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Application started.");
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Application stopping.");
        return Task.CompletedTask;
    }
}
