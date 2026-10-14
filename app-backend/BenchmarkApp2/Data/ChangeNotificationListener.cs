using Dapper;
using Npgsql;

namespace BenchmarkApp2.Data;

/// <summary>
/// Holds one database connection that listens for the change notifications the database sends once
/// a change has committed (see migration 0006_change_notifications.sql), whichever instance or
/// process made the change.
/// </summary>
public sealed class ChangeNotificationListener(NpgsqlDataSource dataSource)
{
    /// <summary>The notification channel the change triggers notify.</summary>
    public const string Channel = "change_events";

    /// <summary>The application name the listening connection reports to the database, so it can be told apart.</summary>
    public const string ApplicationName = "BenchmarkApp2 change listener";

    /// <summary>
    /// How long the connection may stay quiet before it is checked, so a connection that has died
    /// without the database closing it (e.g. a network failure) is noticed.
    /// </summary>
    private static readonly TimeSpan ConnectionCheckInterval = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Listens until cancelled, passing each notification's payload to <paramref name="onNotification"/>.
    /// <paramref name="onListening"/> is called once the connection is listening. Throws when the
    /// connection fails or is lost.
    /// </summary>
    public async Task ListenAsync(Action<string> onNotification, Action onListening, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        connection.Notification += (_, notification) => onNotification(notification.Payload);
        await connection.ExecuteAsync(new CommandDefinition(
            $"SET application_name = '{ApplicationName}'; LISTEN {Channel}", cancellationToken: cancellationToken));
        onListening();

        while (true)
        {
            if (!await connection.WaitAsync(ConnectionCheckInterval, cancellationToken))
            {
                await connection.ExecuteAsync(new CommandDefinition("SELECT 1", cancellationToken: cancellationToken));
            }
        }
    }
}
