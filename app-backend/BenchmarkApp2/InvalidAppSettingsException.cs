namespace BenchmarkApp2;

/// <summary>Thrown when the application starts with one or more invalid <see cref="AppSettings"/>.</summary>
public sealed class InvalidAppSettingsException(IReadOnlyList<string> errors)
    : Exception(FormatMessage(errors))
{
    /// <summary>One message per invalid setting, naming the setting and its value.</summary>
    public IReadOnlyList<string> Errors { get; } = errors;

    private static string FormatMessage(IReadOnlyList<string> errors) =>
        $"The application cannot start because {errors.Count} setting(s) are invalid:{Environment.NewLine}"
        + string.Join(Environment.NewLine, errors.Select(error => $"  - {error}"));
}
