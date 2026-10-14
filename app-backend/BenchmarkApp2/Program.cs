using Twenty57.Builder.ApplicationRuntime.Interfaces;
using Twenty57.Builder.ApplicationRuntime.Sdk;
using BenchmarkApp2;
using BenchmarkApp2.Database;
using Npgsql;

var builder = Host.CreateApplicationBuilder();

var appSettings = builder.Configuration.Get<AppSettings>()!;
builder.Services.AddSingleton<IAppSettings>(appSettings);
builder.Services.AddSingleton(appSettings);

// Created on first use, after the runner has applied any setting overrides.
builder.Services.AddSingleton(services => NpgsqlDataSource.Create(services.GetRequiredService<AppSettings>().DatabaseConnectionString));
builder.Services.AddSingleton<Migrator>();
builder.Services.AddSingleton(TimeProvider.System);

builder.Services.AddSingleton<BenchmarkApp2.Services.TransactionApi.Service>();
builder.Services.AddSingleton<BenchmarkApp2.Services.FileProcessor.Service>();

builder.Services.AddHostedService<Application>();

await Runner.RunAsync(builder.Build()).ConfigureAwait(false);
