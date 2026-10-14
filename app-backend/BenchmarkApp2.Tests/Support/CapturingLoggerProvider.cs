using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace BenchmarkApp2.Tests.Support;

/// <summary>Keeps every message logged through it, so a scenario can check what was logged.</summary>
public sealed class CapturingLoggerProvider : ILoggerProvider
{
    private readonly ConcurrentQueue<LoggedMessage> _messages = new();

    public IReadOnlyCollection<LoggedMessage> Messages => _messages;

    public ILogger CreateLogger(string categoryName) => new Logger(categoryName, _messages);

    public void Dispose()
    {
    }

    public sealed record LoggedMessage(string Category, LogLevel Level, string Text);

    private sealed class Logger(string category, ConcurrentQueue<LoggedMessage> messages) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            messages.Enqueue(new LoggedMessage(category, logLevel, formatter(state, exception)));
    }
}
