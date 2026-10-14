using System.Security.Cryptography;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class CurrentUserStepDefinitions(ApiScenarioState state)
{
    [Given("I have a session cookie that was never issued")]
    public void GivenIHaveASessionCookieThatWasNeverIssued()
    {
        state.SessionCookie = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    }
}
