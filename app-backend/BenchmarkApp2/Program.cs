using Twenty57.Builder.ApplicationRuntime.Interfaces;
using Twenty57.Builder.ApplicationRuntime.Sdk;
using BenchmarkApp2;

var builder = Host.CreateApplicationBuilder();

var appSettings = builder.Configuration.Get<AppSettings>()!;
builder.Services.AddSingleton<IAppSettings>(appSettings);
builder.Services.AddSingleton(appSettings);

builder.Services.AddHostedService<Application>();

await Runner.RunAsync(builder.Build()).ConfigureAwait(false);
