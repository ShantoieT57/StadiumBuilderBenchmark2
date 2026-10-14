using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class SessionInactivityStepDefinitions(TransactionApiFixture api)
{
    [Given("the session inactivity timeout is set to {int} minutes")]
    public void GivenTheSessionInactivityTimeoutIsSetTo(int minutes)
    {
        api.Settings.SessionInactivityTimeoutMinutes = minutes;
    }
}
