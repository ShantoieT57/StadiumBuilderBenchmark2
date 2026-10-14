using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class ApproveTransactionStepDefinitions(
    FileSeeder fileSeeder,
    TransactionSeeder transactionSeeder,
    ReviewClient reviewer)
{
    [When("I approve the transaction {string}")]
    public Task WhenIApproveTheTransaction(string reference) => reviewer.ApproveAsync(transactionSeeder.GetTransactionId(reference));

    [When("I approve the transaction with the id {string}")]
    public Task WhenIApproveTheTransactionWithTheId(string id) => reviewer.ApproveAsync(Guid.Parse(id));

    [When("I approve the first transaction of the file {string}")]
    public async Task WhenIApproveTheFirstTransactionOfTheFile(string fileName)
    {
        var transaction = (await TestDatabase.GetTransactionsAsync(fileSeeder.GetFileId(fileName)))[0];
        await reviewer.ApproveAsync(transaction.Id);
    }
}
