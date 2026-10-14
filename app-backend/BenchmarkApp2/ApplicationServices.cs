using BenchmarkApp2.Database;
using Npgsql;
using Twenty57.Builder.ApplicationRuntime.Interfaces;

namespace BenchmarkApp2;

public static class ApplicationServices
{
    /// <summary>
    /// Registers the settings, the <see cref="Application"/> hosted service and everything it starts.
    /// The database data source is created on first use, after the runner has applied any setting
    /// overrides and the application has checked them.
    /// </summary>
    public static IServiceCollection AddApplication(this IServiceCollection services, AppSettings settings)
    {
        services.AddSingleton<IAppSettings>(settings);
        services.AddSingleton(settings);
        services.AddSingleton(provider => NpgsqlDataSource.Create(provider.GetRequiredService<AppSettings>().DatabaseConnectionString));
        services.AddSingleton<Migrator>();
        services.AddSingleton(TimeProvider.System);

        services.AddSingleton<Services.TransactionApi.Service>();
        services.AddSingleton<Services.FileProcessor.Service>();

        services.AddHostedService<Application>();
        return services;
    }
}
