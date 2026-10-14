using Twenty57.Builder.ApplicationRuntime.Interfaces;

namespace BenchmarkApp2;

public sealed class AppSettings : IAppSettings
{
    /// <summary>
    /// The URI the TransactionApi REST host listens on. Any path (e.g. "/api") is applied as the
    /// request path base; only the scheme and authority are used to bind the listener.
    /// </summary>
    public string TransactionApiUri { get; set; } = "http://localhost:5100/api";

    /// <summary>The PostgreSQL connection string for the application database.</summary>
    public string DatabaseConnectionString { get; set; } =
        "Host=localhost;Port=5433;Database=benchmark_app_2;Username=postgres;Password=postgres";
}
