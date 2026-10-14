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

    [When("I sign in with the request body {string}")]
    public async Task WhenISignInWithTheRequestBody(string body)
    {
        await state.RecordResponseAsync(await api.SendJsonTextAsync(HttpMethod.Post, "auth/sign-in", body));
    }

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

    private async Task SignInAsync(object body)
    {
        await state.RecordResponseAsync(await api.SendAsync(HttpMethod.Post, "auth/sign-in", body));
    }
}
