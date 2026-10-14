using System.ComponentModel;
using System.Globalization;
using BenchmarkApp2.Tests.Support;
using Microsoft.Extensions.Logging;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class StartupSettingsStepDefinitions(ApplicationFixture application)
{
    private IReadOnlyList<string> _reportedErrors = [];
    private Exception? _startupFailure;

    [When("the default settings are checked")]
    public void WhenTheDefaultSettingsAreChecked()
    {
        _reportedErrors = AppSettingsValidator.Validate(new AppSettings());
    }

    [Then("no setting is reported as invalid")]
    public void ThenNoSettingIsReportedAsInvalid()
    {
        Assert.Empty(_reportedErrors);
    }

    /// <remarks>The fixture's settings are valid until a scenario changes them.</remarks>
    [Given("the application's settings are valid")]
    public void GivenTheApplicationsSettingsAreValid()
    {
        Assert.Empty(AppSettingsValidator.Validate(application.Settings));
    }

    /// <summary>Sets the named <see cref="AppSettings"/> property from its text, as an environment variable override would.</summary>
    [Given("the application setting {string} is {string}")]
    public void GivenTheApplicationSettingIs(string setting, string value)
    {
        var property = typeof(AppSettings).GetProperty(setting)
            ?? throw new InvalidOperationException($"AppSettings has no setting \"{setting}\".");
        property.SetValue(
            application.Settings,
            TypeDescriptor.GetConverter(property.PropertyType).ConvertFromString(null, CultureInfo.InvariantCulture, value));
    }

    [When("the application is started")]
    public async Task WhenTheApplicationIsStarted()
    {
        _startupFailure = await Record.ExceptionAsync(() => application.Application.StartAsync(CancellationToken.None));
    }

    [Then("the application fails to start, reporting:")]
    public void ThenTheApplicationFailsToStartReporting(DataTable expected)
    {
        var expectedErrors = expected.Rows.Select(row => row["error"]).ToList();
        var failure = Assert.IsType<InvalidAppSettingsException>(_startupFailure);
        Assert.Equal(expectedErrors, failure.Errors);

        var logged = Assert.Single(
            application.Log.Messages,
            message => message.Category == typeof(Application).FullName && message.Level >= LogLevel.Error);
        Assert.All(expectedErrors, error => Assert.Contains(error, logged.Text, StringComparison.Ordinal));
    }

    [Then("the application's TransactionApi is running")]
    public void ThenTheApplicationsTransactionApiIsRunning()
    {
        Assert.Null(_startupFailure);
        Assert.True(application.TransactionApi?.IsRunning);
    }

    [Then("the application's TransactionApi is not running")]
    public void ThenTheApplicationsTransactionApiIsNotRunning()
    {
        Assert.False(application.TransactionApi?.IsRunning ?? false);
    }

    [Then("the application's file processor is running")]
    public void ThenTheApplicationsFileProcessorIsRunning()
    {
        Assert.Null(_startupFailure);
        Assert.True(application.FileProcessor?.IsRunning);
    }

    [Then("the application's file processor is not running")]
    public void ThenTheApplicationsFileProcessorIsNotRunning()
    {
        Assert.False(application.FileProcessor?.IsRunning ?? false);
    }
}
