using System.Globalization;
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

    [Then("every transaction from the last uploaded file was created and last changed by {string} at the current time")]
    public async Task ThenEveryTransactionWasCreatedAndLastChangedBy(string changedBy)
    {
        var transactions = await TestDatabase.GetTransactionsAsync(state.LastUploadedFileId);
        Assert.NotEmpty(transactions);
        Assert.All(transactions, transaction =>
        {
            Assert.Equal(changedBy, transaction.CreatedBy);
            Assert.Equal(changedBy, transaction.LastChangedBy);
            TimeAssert.IsCurrentTime(transaction.CreatedAt, clock);
            TimeAssert.IsCurrentTime(transaction.LastChangedAt, clock);
        });
    }

    [Then("the transactions loaded from the last uploaded file are:")]
    public async Task ThenTheTransactionsLoadedFromTheLastUploadedFileAre(DataTable expected)
    {
        var transactions = await TestDatabase.GetTransactionsAsync(state.LastUploadedFileId);
        Assert.Equal(expected.RowCount, transactions.Count);
        foreach (var (row, transaction) in expected.Rows.Zip(transactions))
        {
            Assert.Equal(row["Reference"], transaction.Reference);
            Assert.Equal(row["TransactionDate"], TransactionValues.FormatDate(transaction.TransactionDate));
            Assert.Equal(row["AccountNumber"], transaction.AccountNumber);
            Assert.Equal(row["Description"], transaction.Description);
            Assert.Equal(decimal.Parse(row["Amount"], CultureInfo.InvariantCulture), transaction.Amount);
            Assert.Equal(row["TransactionType"], transaction.TransactionType);
            Assert.Equal(row["Currency"], transaction.Currency);
            Assert.Equal(row["Status"], transaction.Status);
        }
    }

    [Then("the transaction {string} still has the description {string} and belongs to uploaded file {int}")]
    public async Task ThenTheTransactionStillHasTheDescriptionAndBelongsToUploadedFile(string reference, string description, int position)
    {
        var transaction = await TransactionValues.GetByReferenceAsync(reference);
        Assert.Equal(description, transaction.Description);
        Assert.Equal(state.GetUploadedFileId(position), transaction.FileId);
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
