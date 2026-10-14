using System.Text.Json;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class SignInStepDefinitions(TransactionApiFixture api, ApiScenarioState state)
{
    [When("I sign in with email {string} and password {string}")]
    public Task WhenISignInWith(string email, string password) => SignInAsync(new { email, password });

    [When("I sign in without supplying an email address or password")]
    public Task WhenISignInWithoutCredentials() => SignInAsync(new { });

    [Then("an HttpOnly session cookie is issued")]
    public void ThenAnHttpOnlySessionCookieIsIssued()
    {
        Assert.False(string.IsNullOrWhiteSpace(state.IssuedSessionCookieValue));
        Assert.Contains("httponly", state.IssuedSessionCookieHeader, StringComparison.OrdinalIgnoreCase);
    }

    [Then("no session cookie is issued")]
    public void ThenNoSessionCookieIsIssued()
    {
        Assert.Null(state.IssuedSessionCookieHeader);
    }

    [Then("the validation errors include the field {string}")]
    public void ThenTheValidationErrorsIncludeTheField(string field)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        var fields = json.RootElement.GetProperty("errors").EnumerateObject().Select(error => error.Name);
        Assert.Contains(fields, name => string.Equals(name, field, StringComparison.OrdinalIgnoreCase));
    }

    private async Task SignInAsync(object body)
    {
        await state.RecordResponseAsync(await api.SendAsync(HttpMethod.Post, "auth/sign-in", body));
    }
}
