using System.Text.Json;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class DashboardSummaryStepDefinitions(TransactionApiFixture api, ApiScenarioState state)
{
    [When("I request the dashboard summary")]
    public async Task WhenIRequestTheDashboardSummary()
    {
        await state.RecordResponseAsync(await api.SendAsync(HttpMethod.Get, "dashboard/summary", sessionCookie: state.SessionCookie));
    }

    [Then("the dashboard counts {int} Uploaded, {int} Processing, {int} Completed and {int} Failed files")]
    public void ThenTheDashboardCountsFiles(int uploaded, int processing, int completed, int failed)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        var files = json.RootElement.GetProperty("files");
        Assert.Equal(
            (uploaded, processing, completed, failed),
            (files.GetProperty("uploaded").GetInt32(), files.GetProperty("processing").GetInt32(),
             files.GetProperty("completed").GetInt32(), files.GetProperty("failed").GetInt32()));
    }

    [Then("the dashboard counts {int} Imported, {int} Approved and {int} Rejected transactions")]
    public void ThenTheDashboardCountsTransactions(int imported, int approved, int rejected)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        var transactions = json.RootElement.GetProperty("transactions");
        Assert.Equal(
            (imported, approved, rejected),
            (transactions.GetProperty("imported").GetInt32(), transactions.GetProperty("approved").GetInt32(),
             transactions.GetProperty("rejected").GetInt32()));
    }
}
