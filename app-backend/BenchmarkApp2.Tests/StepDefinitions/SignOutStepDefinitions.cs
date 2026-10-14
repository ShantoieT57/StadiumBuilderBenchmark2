using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class SignOutStepDefinitions(TransactionApiFixture api, ApiScenarioState state)
{
    /// <summary>
    /// Sends the current session cookie but deliberately keeps it in the scenario state, so later
    /// steps can prove that the ended session no longer authenticates.
    /// </summary>
    [When("I sign out")]
    public async Task WhenISignOut()
    {
        await state.RecordResponseAsync(await api.SendAsync(HttpMethod.Post, "auth/sign-out", sessionCookie: state.SessionCookie));
    }

    [Then("the session cookie is cleared")]
    public void ThenTheSessionCookieIsCleared()
    {
        Assert.Contains("expires=Thu, 01 Jan 1970", state.IssuedSessionCookieHeader, StringComparison.OrdinalIgnoreCase);
    }
}
