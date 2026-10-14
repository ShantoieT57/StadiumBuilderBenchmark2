using System.Text.Json;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class TransactionDetailsStepDefinitions(
    TransactionApiFixture api,
    FileSeeder fileSeeder,
    ApiScenarioState state)
{
    [When("I open the transaction with the id {string}")]
    public Task WhenIOpenTheTransactionWithTheId(string id) => OpenTransactionAsync(Guid.Parse(id));

    [When("I open the first transaction of the file {string}")]
    public async Task WhenIOpenTheFirstTransactionOfTheFile(string fileName)
    {
        var transaction = (await TestDatabase.GetTransactionsAsync(fileSeeder.GetFileId(fileName)))[0];
        await OpenTransactionAsync(transaction.Id);
    }

    [Then("the transaction's amount is exactly {word}")]
    public void ThenTheTransactionsAmountIsExactly(string amount)
    {
        using var json = JsonDocument.Parse(state.LastResponseBody);
        var actual = json.RootElement.GetProperty("amount");
        Assert.Equal(JsonValueKind.Number, actual.ValueKind);
        Assert.Equal(amount, actual.GetRawText());
    }

    private async Task OpenTransactionAsync(Guid id)
    {
        await state.RecordResponseAsync(await api.SendAsync(HttpMethod.Get, $"transactions/{id}", sessionCookie: state.SessionCookie));
    }
}
