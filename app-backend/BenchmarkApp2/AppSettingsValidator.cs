using System.Globalization;

namespace BenchmarkApp2;

/// <summary>
/// Checks <see cref="AppSettings"/> when the application starts, so a setting that would only fail
/// later (while handling a request or processing a file) stops startup straight away instead. Every
/// invalid setting is reported, in the order the settings are declared, each naming the setting and
/// its value.
/// </summary>
/// <remarks>
/// <see cref="AppSettings.ExportTimeZone"/> must be an id that <see cref="TimeZoneInfo.TryFindSystemTimeZoneById"/>
/// resolves: an IANA id (e.g. "Europe/London") on every platform, and a Windows id
/// (e.g. "GMT Standard Time") where .NET can convert it, i.e. on Windows and wherever ICU is available.
/// </remarks>
public static class AppSettingsValidator
{
    /// <summary>The application-service gRPC endpoint's default port (ASPNETCORE_URLS), which no other listener may use.</summary>
    private const int ApplicationServicePort = 5000;

    public static IReadOnlyList<string> Validate(AppSettings settings)
    {
        var errors = new List<string>();
        CheckTransactionApiUri(settings.TransactionApiUri, errors);
        CheckPositive(nameof(AppSettings.SessionInactivityTimeoutMinutes), settings.SessionInactivityTimeoutMinutes, errors);
        CheckPositive(nameof(AppSettings.MaxUploadSizeBytes), settings.MaxUploadSizeBytes, errors);
        if (string.IsNullOrWhiteSpace(settings.DatabaseConnectionString))
        {
            // The value is never echoed: a connection string can hold a password.
            errors.Add($"{nameof(AppSettings)}.{nameof(AppSettings.DatabaseConnectionString)} must not be empty.");
        }
        CheckPositive(nameof(AppSettings.FileProcessorPollIntervalSeconds), settings.FileProcessorPollIntervalSeconds, errors);
        if (!TimeZoneInfo.TryFindSystemTimeZoneById(settings.ExportTimeZone, out _))
        {
            errors.Add($"{Describe(nameof(AppSettings.ExportTimeZone), settings.ExportTimeZone)} is not a known time zone.");
        }
        return errors;
    }

    /// <exception cref="InvalidAppSettingsException">One or more settings are invalid.</exception>
    public static void ThrowIfInvalid(AppSettings settings)
    {
        var errors = Validate(settings);
        if (errors.Count > 0)
        {
            throw new InvalidAppSettingsException(errors);
        }
    }

    private static void CheckTransactionApiUri(string value, List<string> errors)
    {
        var name = nameof(AppSettings.TransactionApiUri);
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            errors.Add($"{Describe(name, value)} must be an absolute http or https URI.");
        }
        else if (uri.Port == ApplicationServicePort)
        {
            errors.Add($"{Describe(name, value)} must not use port {ApplicationServicePort}, which the application-service endpoint uses.");
        }
    }

    private static void CheckPositive(string name, long value, List<string> errors)
    {
        if (value <= 0)
        {
            errors.Add($"{Describe(name, value.ToString(CultureInfo.InvariantCulture))} must be greater than 0.");
        }
    }

    private static string Describe(string name, string value) => $"{nameof(AppSettings)}.{name} \"{value}\"";
}
