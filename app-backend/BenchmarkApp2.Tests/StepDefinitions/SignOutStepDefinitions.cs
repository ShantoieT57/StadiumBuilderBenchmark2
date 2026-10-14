using BenchmarkApp2.Services.TransactionApi;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class SignOutStepDefinitions(TransactionApiFixture api, ApiScenarioState state, ManualTimeProvider clock)
{
    /// <summary>
    /// Signing in always ends a person's other sessions, so a second session that is still open on
    /// another device is added directly to the database.
    /// </summary>
    [Given("{string} also has an active session in browser {string}")]
    public async Task GivenAlsoHasAnActiveSessionInBrowser(string email, string browser)
    {
        var token = SessionCookie.CreateToken();
        await TestDatabase.InsertActiveSessionAsync(email, SessionCookie.HashToken(token), clock.GetUtcNow());
        state.BrowserSessionCookies[browser] = token;
    }

    /// <summary>
    /// Sends the current session cookie but deliberately keeps it in the scenario state, so later
    /// steps can prove that the ended session no longer authenticates.
    /// </summary>
    [When("I sign out")]
    public Task WhenISignOut() => SignOutAsync(state.SessionCookie);

    [When("I sign out in browser {string}")]
    public Task WhenISignOutInBrowser(string browser) => SignOutAsync(state.GetBrowserSessionCookie(browser));

    [Then("the session cookie is cleared")]
    public void ThenTheSessionCookieIsCleared()
    {
        Assert.Contains("expires=Thu, 01 Jan 1970", state.IssuedSessionCookieHeader, StringComparison.OrdinalIgnoreCase);
    }

    private async Task SignOutAsync(string? sessionCookie)
    {
        await state.RecordResponseAsync(await api.SendAsync(HttpMethod.Post, "auth/sign-out", sessionCookie: sessionCookie));
    }
}
