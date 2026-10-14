using Twenty57.Builder.ApplicationRuntime.Sdk;
using BenchmarkApp2;

var builder = Host.CreateApplicationBuilder();

builder.Services.AddApplication(builder.Configuration.Get<AppSettings>()!);

await Runner.RunAsync(builder.Build()).ConfigureAwait(false);
