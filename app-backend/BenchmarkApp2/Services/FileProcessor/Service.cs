using BenchmarkApp2.Data;
using Dapper;
using Npgsql;
using Twenty57.Builder.ApplicationRuntime.Interfaces;

namespace BenchmarkApp2.Services.FileProcessor;

/// <summary>
/// Processes uploaded files in the background (UP-07), and can be started and stopped independently.
/// While running it listens for the database notification sent when a file is uploaded, so an
/// upload is processed straight away, and also checks for waiting files every
/// <see cref="AppSettings.FileProcessorPollIntervalSeconds"/> in case a notification was missed.
/// When it starts, it first returns files that an interrupted processor left in Processing to
/// Uploaded. Several instances can run against the same database: each file is claimed by one.
/// </summary>
public sealed class Service : IService
{
    /// <summary>The notification channel the files table's insert trigger notifies.</summary>
    private const string UploadChannel = "file_uploaded";

    private readonly AppSettings _settings;
    private readonly NpgsqlDataSource _dataSource;
    private readonly Processor _processor;
    private readonly ILogger<Service> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private CancellationTokenSource? _stopping;
    private Task? _running;

    public Service(AppSettings settings, NpgsqlDataSource dataSource, TimeProvider timeProvider, ILoggerFactory loggerFactory)
    {
        _settings = settings;
        _dataSource = dataSource;
        _processor = new Processor(new FileProcessingRepository(dataSource), timeProvider, loggerFactory.CreateLogger<Processor>());
        _logger = loggerFactory.CreateLogger<Service>();
    }

    public bool IsRunning => _running is not null;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            if (_running is not null)
            {
                return;
            }

            _stopping = new CancellationTokenSource();
            var stoppingToken = _stopping.Token;
            _running = Task.Run(() => RunAsync(stoppingToken), CancellationToken.None);
            _logger.LogInformation("FileProcessor started.");
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
            if (_running is null)
            {
                return;
            }

            await _stopping!.CancelAsync();
            await _running.WaitAsync(cancellationToken);
            _stopping.Dispose();
            _stopping = null;
            _running = null;
            _logger.LogInformation("FileProcessor stopped.");
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>
    /// Recovers interrupted files, then processes waiting files whenever an upload is notified or the
    /// interval passes, until stopped. A lost database connection is retried after the interval.
    /// </summary>
    private async Task RunAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromSeconds(Math.Max(1, _settings.FileProcessorPollIntervalSeconds));
        var recovered = false;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var listener = await _dataSource.OpenConnectionAsync(stoppingToken);
                await listener.ExecuteAsync(new CommandDefinition($"LISTEN {UploadChannel}", cancellationToken: stoppingToken));

                if (!recovered)
                {
                    await _processor.RecoverInterruptedFilesAsync(stoppingToken);
                    recovered = true;
                }

                while (true)
                {
                    await _processor.ProcessWaitingFilesAsync(stoppingToken);
                    await listener.WaitAsync(interval, stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                _logger.LogError(exception, "FileProcessor failed; retrying in {Interval}.", interval);
                try
                {
                    await Task.Delay(interval, stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
        }
    }
}
