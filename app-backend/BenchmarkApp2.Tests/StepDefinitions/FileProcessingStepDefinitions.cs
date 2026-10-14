using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class FileProcessingStepDefinitions(ApiScenarioState state, ManualTimeProvider clock)
{
    [Then("{int} transactions have been loaded from the last uploaded file, all with the status {string}")]
    public async Task ThenTransactionsHaveBeenLoadedFromTheLastUploadedFile(int count, string status)
    {
        var transactions = await TestDatabase.GetTransactionsAsync(state.LastUploadedFileId);
        Assert.Equal(count, transactions.Count);
        Assert.All(transactions, transaction => Assert.Equal(status, transaction.Status));
    }

    [Then("the transactions from the last uploaded file include {int} of type {string} totalling {decimal} {string}")]
    public async Task ThenTheTransactionsIncludeOfTypeTotalling(int count, string transactionType, decimal total, string currency)
    {
        var ofType = (await TestDatabase.GetTransactionsAsync(state.LastUploadedFileId))
            .Where(transaction => transaction.TransactionType == transactionType)
            .ToList();
        Assert.Equal(count, ofType.Count);
        Assert.Equal(total, ofType.Sum(transaction => transaction.Amount));
        Assert.All(ofType, transaction => Assert.Equal(currency, transaction.Currency));
    }

    [Then("every stage in the processing history of the last uploaded file started and finished at the current time")]
    public async Task ThenEveryStageStartedAndFinishedAtTheCurrentTime()
    {
        var history = await TestDatabase.GetProcessingStagesAsync(state.LastUploadedFileId);
        Assert.NotEmpty(history);
        Assert.All(history, stage =>
        {
            TimeAssert.IsCurrentTime(stage.StartedAt, clock);
            Assert.NotNull(stage.FinishedAt);
            TimeAssert.IsCurrentTime(stage.FinishedAt.Value, clock);
        });
    }
}
