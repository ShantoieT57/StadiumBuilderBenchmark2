using BenchmarkApp2.Data;
using BenchmarkApp2.Services.FileProcessor;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;

namespace BenchmarkApp2.Tests.Support;

/// <summary>
/// Runs the file processor against the test database for one scenario, either directly (so a
/// scenario decides exactly when waiting files are processed) or as the background service.
/// The processor reads the time from the scenario's <see cref="ManualTimeProvider"/>.
/// </summary>
public sealed class FileProcessorFixture(ManualTimeProvider clock) : IAsyncDisposable
{
    private static readonly TimeSpan StatusTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan StatusCheckInterval = TimeSpan.FromMilliseconds(50);

    private readonly List<NpgsqlDataSource> _dataSources = [];
    private Service? _service;

    /// <summary>
    /// The settings the service is built with; change them before it is first used. The interval is
    /// long by default, so a scenario only sees files processed because the service was woken.
    /// </summary>
    public AppSettings Settings { get; } = new()
    {
        DatabaseConnectionString = TestDatabase.ConnectionString,
        FileProcessorPollIntervalSeconds = 300,
    };

    public Service Service => _service ??= new Service(Settings, CreateDataSource(), clock, NullLoggerFactory.Instance);

    /// <summary>Processes every waiting file once, as one processor.</summary>
    public Task ProcessWaitingFilesAsync() => CreateProcessor().ProcessWaitingFilesAsync(CancellationToken.None);

    /// <summary>Processes the waiting files with several processors, each with its own connections, at once.</summary>
    public Task ProcessWaitingFilesConcurrentlyAsync(int processorCount)
    {
        var processors = Enumerable.Range(0, processorCount).Select(_ => CreateProcessor()).ToList();
        return Task.WhenAll(processors.Select(processor => Task.Run(() => processor.ProcessWaitingFilesAsync(CancellationToken.None))));
    }

    /// <summary>Waits for the background service to give a file the status, failing after a timeout.</summary>
    public static async Task WaitForStatusAsync(Guid fileId, string status)
    {
        using var timeout = new CancellationTokenSource(StatusTimeout);
        string current;
        while ((current = (await TestDatabase.GetProcessedFileAsync(fileId)).Status) != status)
        {
            if (timeout.IsCancellationRequested)
            {
                Assert.Fail($"The file still had the status \"{current}\" after {StatusTimeout.TotalSeconds} seconds, not \"{status}\".");
            }
            await Task.Delay(StatusCheckInterval);
        }
    }

    private Processor CreateProcessor() =>
        new(new FileProcessingRepository(CreateDataSource()), clock, NullLogger<Processor>.Instance);

    private NpgsqlDataSource CreateDataSource()
    {
        var dataSource = NpgsqlDataSource.Create(Settings.DatabaseConnectionString);
        _dataSources.Add(dataSource);
        return dataSource;
    }

    /// <summary>Stops the service and releases every connection. Safe to call more than once.</summary>
    public async ValueTask DisposeAsync()
    {
        if (_service is not null)
        {
            await _service.StopAsync(CancellationToken.None);
            _service = null;
        }
        foreach (var dataSource in _dataSources)
        {
            await dataSource.DisposeAsync();
        }
        _dataSources.Clear();
    }
}
