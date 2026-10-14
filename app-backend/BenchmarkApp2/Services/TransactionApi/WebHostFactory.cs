using BenchmarkApp2.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Npgsql;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Builds the TransactionApi web application. Shared by <see cref="Service"/> and the tests, which
/// pass <c>configure</c> to host it on an in-memory test server.
/// </summary>
public static class WebHostFactory
{
    private const string SwaggerRoutePrefix = "swagger";
    private const string OpenApiSpecFileName = "TransactionApi.yaml";
    private const string OpenApiSpecResourceName = "OpenApi/TransactionApi.yaml";

    public static WebApplication Create(
        AppSettings settings,
        string environmentName,
        NpgsqlDataSource dataSource,
        Action<WebApplicationBuilder>? configure = null)
    {
        var (hostUrl, pathBase) = SplitUri(settings.TransactionApiUri);

        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = environmentName,
            ApplicationName = typeof(WebHostFactory).Assembly.GetName().Name,
        });
        builder.WebHost.UseUrls(hostUrl);
        RegisterServices(builder.Services, settings, dataSource);
        configure?.Invoke(builder);

        var app = builder.Build();
        ConfigurePipeline(app, pathBase);
        return app;
    }

    /// <remarks>
    /// The system clock is registered as the <see cref="TimeProvider"/>; tests replace it from
    /// <c>configure</c> to control time.
    /// </remarks>
    private static void RegisterServices(IServiceCollection services, AppSettings settings, NpgsqlDataSource dataSource)
    {
        services.AddSingleton(settings);
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton(dataSource);
        services.AddSingleton<UserRepository>();
        services.AddSingleton<SessionRepository>();
        services.AddSingleton<IPasswordHasher<UserRecord>, PasswordHasher<UserRecord>>();
        services.AddSingleton<SessionManager>();
        services.AddSingleton<FileRepository>();
        services.AddSingleton<FileReceiver>();
        services.AddSingleton<DashboardRepository>();
        services.AddSingleton<FileDetailsRepository>();
        services.AddSingleton<FileCancellationRepository>();
        services.AddSingleton<FileProcessingRepository>();
        services.AddSingleton<FileProcessor.Corrector>();

        services.AddControllers().AddApplicationPart(typeof(Controller).Assembly);
        services
            .AddAuthentication(SessionAuthenticationHandler.SchemeName)
            .AddScheme<AuthenticationSchemeOptions, SessionAuthenticationHandler>(SessionAuthenticationHandler.SchemeName, null);
        services.AddAuthorization(options =>
        {
            // Every endpoint requires a signed-in session unless it explicitly allows anonymous access.
            options.DefaultPolicy = new AuthorizationPolicyBuilder(SessionAuthenticationHandler.SchemeName)
                .RequireAuthenticatedUser()
                .Build();
            options.FallbackPolicy = options.DefaultPolicy;
        });
    }

    private static void ConfigurePipeline(WebApplication app, PathString pathBase)
    {
        // The path base must come before any other middleware so routing sees the remaining path.
        if (pathBase.HasValue)
        {
            app.UsePathBase(pathBase);
        }
        app.UseRouting();

        var isDevelopment = app.Environment.IsDevelopment();
        if (isDevelopment)
        {
            // Registered before authentication so the fallback policy never blocks the UI assets.
            app.UseSwaggerUI(options =>
            {
                options.RoutePrefix = SwaggerRoutePrefix;
                options.SwaggerEndpoint(OpenApiSpecFileName, "TransactionApi");
            });
        }

        app.UseAuthentication();
        app.UseAuthorization();

        if (isDevelopment)
        {
            app.MapGet($"{SwaggerRoutePrefix}/{OpenApiSpecFileName}", () => Results.Bytes(LoadOpenApiSpec(), "application/yaml"))
                .AllowAnonymous()
                .ExcludeFromDescription();
        }
        app.MapControllers();
    }

    /// <summary>
    /// Splits the configured URI into the scheme and authority the listener binds to and the path
    /// that is applied as the request path base. Done for every URI because the setting can be
    /// changed to any value at deployment time.
    /// </summary>
    private static (string HostUrl, PathString PathBase) SplitUri(string uri)
    {
        var parsed = new Uri(uri, UriKind.Absolute);
        return (parsed.GetLeftPart(UriPartial.Authority), new PathString(parsed.AbsolutePath.TrimEnd('/')));
    }

    private static byte[] LoadOpenApiSpec()
    {
        using var stream = typeof(WebHostFactory).Assembly.GetManifestResourceStream(OpenApiSpecResourceName)!;
        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        return memory.ToArray();
    }
}
