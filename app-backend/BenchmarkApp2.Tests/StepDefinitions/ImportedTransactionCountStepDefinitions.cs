using System.Text.Json;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class ImportedTransactionCountStepDefinitions(TransactionApiFixture api, ApiScenarioState state)
{
    [When("I request the number of imported transactions")]
    public async Task WhenIRequestTheNumberOfImportedTransactions()
    {
        await state.RecordResponseAsync(await api.SendAsync(HttpMethod.Get, "transactions/imported-count", sessionCookie: state.SessionCookie));
    }

    [Then("the number of imported transactions is {int}")]
    public void ThenTheNumberOfImportedTransactionsIs(int count)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        Assert.Equal(count, json.RootElement.GetProperty("count").GetInt32());
    }
}
