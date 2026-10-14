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
        "Host=localhost;Port=5433;Database=benchmark_app_2;Username=postgres;Password=postgres";
}
