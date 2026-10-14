using Twenty57.Builder.ApplicationRuntime.Interfaces;

namespace BenchmarkApp2;

public sealed class AppSettings : IAppSettings
{
    /// <summary>
    /// The URI the TransactionApi REST host listens on. Any path (e.g. "/api") is applied as the
    /// request path base; only the scheme and authority are used to bind the listener.
    /// </summary>
    public string TransactionApiUri { get; set; } = "http://localhost:5100/api";

    /// <summary>
    /// How many minutes a session may go without any authenticated request before it expires and
    /// the person must sign in again. Every authenticated request restarts the period.
    /// </summary>
    public int SessionInactivityTimeoutMinutes { get; set; } = 60;

    /// <summary>The largest file, in bytes, that can be uploaded. 10 MB by default.</summary>
    public long MaxUploadSizeBytes { get; set; } = 10 * 1024 * 1024;

    /// <summary>The PostgreSQL connection string for the application database.</summary>
    public string DatabaseConnectionString { get; set; } =
        "Host=127.0.0.1;Port=5433;Database=benchmark_app_2;Username=postgres;Password=postgres";

    /// <summary>
    /// How many seconds the file processor waits between checks for uploaded files when it has not
    /// been woken by an upload.
    /// </summary>
    public int FileProcessorPollIntervalSeconds { get; set; } = 10;

    /// <summary>
    /// The IANA time-zone id of the transaction export: the export date in the file name is today's
    /// date in this zone, and each transaction's Last Changed On is written in it. South Africa by
    /// default, where the bank is. A Windows id (e.g. "South Africa Standard Time") is also accepted
    /// where .NET can convert it. An id that does not resolve stops the application at startup.
    /// </summary>
    public string ExportTimeZone { get; set; } = "Africa/Johannesburg";

    /// <summary>
    /// How many seconds apart the live event stream (GET /events) sends a heartbeat, which keeps
    /// proxies from closing an idle connection. The session is checked at every heartbeat, so a stream
    /// ends at most this long after its session has expired, been replaced or been signed out.
    /// Between 1 and 300.
    /// </summary>
    public int EventStreamHeartbeatSeconds { get; set; } = 15;
}
