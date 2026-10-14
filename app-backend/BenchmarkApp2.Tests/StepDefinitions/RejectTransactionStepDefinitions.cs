using System.Text;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class RejectTransactionStepDefinitions(
    FileSeeder fileSeeder,
    TransactionSeeder transactionSeeder,
    ReviewClient reviewer)
{
    [When("I reject the transaction {string} with the reason {string}")]
    public Task WhenIRejectTheTransactionWithTheReason(string reference, string reason) =>
        reviewer.RejectAsync(transactionSeeder.GetTransactionId(reference), reason);

    [When("I reject the transaction {string} with the request body {string}")]
    public Task WhenIRejectTheTransactionWithTheRequestBody(string reference, string body) =>
        reviewer.RejectWithBodyAsync(transactionSeeder.GetTransactionId(reference), body);

    [When("I reject the transaction {string} with {string} repeated {int} times and {int} spaces on each side as the reason")]
    public Task WhenIRejectTheTransactionWithARepeatedReason(string reference, string text, int times, int padding)
    {
        var padded = new StringBuilder()
            .Append(' ', padding)
            .Insert(padding, text, times)
            .Append(' ', padding)
            .ToString();
        return reviewer.RejectAsync(transactionSeeder.GetTransactionId(reference), padded);
    }

    [When("I reject the transaction with the id {string} with the reason {string}")]
    public Task WhenIRejectTheTransactionWithTheIdWithTheReason(string id, string reason) =>
        reviewer.RejectAsync(Guid.Parse(id), reason);

    [When("I reject the first transaction of the file {string} with the reason {string}")]
    public async Task WhenIRejectTheFirstTransactionOfTheFile(string fileName, string reason)
    {
        var transaction = (await TestDatabase.GetTransactionsAsync(fileSeeder.GetFileId(fileName)))[0];
        await reviewer.RejectAsync(transaction.Id, reason);
    }

    /// <summary>An empty reason means that no reason is stored.</summary>
    [Then("the transaction {string} has the stored rejection reason {string}")]
    public async Task ThenTheTransactionHasTheStoredRejectionReason(string reference, string reason)
    {
        var transaction = await TransactionValues.GetByReferenceAsync(reference);
        Assert.Equal(reason.Length == 0 ? null : reason, transaction.RejectionReason);
    }

    /// <summary>The length is counted in UTF-16 code units, as <see cref="string.Length"/> counts it.</summary>
    [Then("the transaction {string} has a stored rejection reason of {int} characters")]
    public async Task ThenTheTransactionHasAStoredRejectionReasonOfCharacters(string reference, int length)
    {
        var transaction = await TransactionValues.GetByReferenceAsync(reference);
        Assert.NotNull(transaction.RejectionReason);
        Assert.Equal(length, transaction.RejectionReason.Length);
        Assert.Equal(transaction.RejectionReason.Trim(), transaction.RejectionReason);
    }
}
