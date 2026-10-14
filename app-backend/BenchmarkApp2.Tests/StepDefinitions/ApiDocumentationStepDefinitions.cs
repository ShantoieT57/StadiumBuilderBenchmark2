using System.Net;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class ApiDocumentationStepDefinitions(TransactionApiFixture api, ApiScenarioState state)
{
    [Given("the TransactionApi is running in the {string} environment")]
    public void GivenTheTransactionApiIsRunningInTheEnvironment(string environmentName)
    {
        api.EnvironmentName = environmentName;
    }

    [When("I request the documentation path {string}")]
    public async Task WhenIRequestTheDocumentationPath(string path)
    {
        await state.RecordResponseAsync(await api.SendAsync(HttpMethod.Get, path));
    }

    [Then("the response body contains {string}")]
    public void ThenTheResponseBodyContains(string text)
    {
        Assert.Contains(text, state.LastResponseBody, StringComparison.Ordinal);
    }

    [Then("the documentation is not served")]
    public void ThenTheDocumentationIsNotServed()
    {
        Assert.NotEqual(HttpStatusCode.OK, state.LastResponse.StatusCode);
        Assert.DoesNotContain("TransactionApi", state.LastResponseBody, StringComparison.Ordinal);
    }
}
