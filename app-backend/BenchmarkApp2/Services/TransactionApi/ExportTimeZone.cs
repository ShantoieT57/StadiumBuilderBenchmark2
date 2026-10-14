namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// The time zone of the transaction export (<see cref="AppSettings.ExportTimeZone"/>), resolved once
/// when the host is built rather than on every export. The setting has already been checked at
/// startup (see <see cref="AppSettingsValidator"/>).
/// </summary>
public sealed record ExportTimeZone(TimeZoneInfo Zone)
{
    public static ExportTimeZone From(AppSettings settings) => new(TimeZoneInfo.FindSystemTimeZoneById(settings.ExportTimeZone));

    /// <summary>Today's date in this time zone.</summary>
    public DateOnly Today(TimeProvider timeProvider) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(timeProvider.GetUtcNow(), Zone).DateTime);
}
