using System.Globalization;
using BenchmarkApp2.Tests.Support;
using Reqnroll;

namespace BenchmarkApp2.Tests.StepDefinitions;

[Binding]
public sealed class FileRowRulesStepDefinitions(ApiScenarioState state, ManualTimeProvider clock, FileUploader uploader)
{
    private const string FileName = "row-rules.csv";
    private const string ReasonSeparator = "; ";

    [Given("I have uploaded a file with one valid row and a row with the transaction type {string}")]
    public Task GivenAFileWithARowWithTheTransactionType(string value) => UploadWithRowUnderTestAsync("TransactionType", value);

    [Given("I have uploaded a file with one valid row and a row with the transaction date {string}")]
    public Task GivenAFileWithARowWithTheTransactionDate(string value) => UploadWithRowUnderTestAsync("TransactionDate", value);

    [Given("I have uploaded a file with one valid row and a row with the amount {string}")]
    public Task GivenAFileWithARowWithTheAmount(string value) => UploadWithRowUnderTestAsync("Amount", value);

    [Given("I have uploaded a file with one valid row and a row with the account number {string}")]
    public Task GivenAFileWithARowWithTheAccountNumber(string value) => UploadWithRowUnderTestAsync("AccountNumber", value);

    [Then("the invalid rows of the last uploaded file are:")]
    public async Task ThenTheInvalidRowsOfTheLastUploadedFileAre(DataTable expected)
    {
        var invalidRows = (await TestDatabase.GetFileRowsAsync(state.LastUploadedFileId))
            .Where(row => row.Reasons.Length > 0)
            .ToList();
        Assert.Equal(
            expected.Rows.Select(row => (int.Parse(row["Row"], CultureInfo.InvariantCulture), row["Reasons"])),
            invalidRows.Select(row => (row.RowNumber, string.Join(ReasonSeparator, row.Reasons))));
    }

    [Then("the rows kept for corrections of the last uploaded file are:")]
    public async Task ThenTheRowsKeptForCorrectionsAre(DataTable expected)
    {
        var rows = await TestDatabase.GetFileRowsAsync(state.LastUploadedFileId);
        Assert.Equal(expected.RowCount, rows.Count);
        foreach (var (row, stored) in expected.Rows.Zip(rows))
        {
            Assert.Equal(int.Parse(row["Row"], CultureInfo.InvariantCulture), stored.RowNumber);
            Assert.Equal(row["Reference"], stored.Reference);
            Assert.Equal(row["TransactionDate"], stored.TransactionDate);
            Assert.Equal(row["AccountNumber"], stored.AccountNumber);
            Assert.Equal(row["Description"], stored.Description);
            Assert.Equal(row["Amount"], stored.Amount);
            Assert.Equal(row["TransactionType"], stored.TransactionType);
            Assert.Equal(row["Currency"], stored.Currency);
            Assert.Equal(int.Parse(row["Columns"], CultureInfo.InvariantCulture), stored.ColumnCount);
            Assert.Equal(row["ExtraValues"], string.Join(';', stored.ExtraValues));
            Assert.Equal(row["Reasons"], string.Join(ReasonSeparator, stored.Reasons));
        }
    }

    [Then("the transaction {string} has the transaction date {string}")]
    public async Task ThenTheTransactionHasTheTransactionDate(string reference, string transactionDate)
    {
        Assert.Equal(transactionDate, TransactionValues.FormatDate((await TransactionValues.GetByReferenceAsync(reference)).TransactionDate));
    }

    [Then("the transaction {string} has the amount {string}")]
    public async Task ThenTheTransactionHasTheAmount(string reference, string amount)
    {
        var stored = (await TransactionValues.GetByReferenceAsync(reference)).Amount;
        Assert.Equal(amount, stored.ToString(CultureInfo.InvariantCulture));
    }

    [Then("the stage {string} of the last uploaded file started at the current time and has not finished")]
    public async Task ThenTheStageStartedAtTheCurrentTimeAndHasNotFinished(string stageName)
    {
        var stage = Assert.Single(await TestDatabase.GetProcessingStagesAsync(state.LastUploadedFileId), stage => stage.Stage == stageName);
        TimeAssert.IsCurrentTime(stage.StartedAt, clock);
        Assert.Null(stage.FinishedAt);
    }

    /// <summary>
    /// Uploads a file whose first row (TXN-1) is valid and whose second row (TXN-2) is valid except
    /// for the one column under test.
    /// </summary>
    private Task UploadWithRowUnderTestAsync(string column, string value)
    {
        var rows = new DataTable("Reference", "TransactionDate", "AccountNumber", "Description", "Amount", "TransactionType", "Currency");
        rows.AddRow("TXN-1", "2026/04/15 08:12", "1001-2034-5567", "Valid row", "10", "C", "ZAR");
        var rowUnderTest = new Dictionary<string, string>
        {
            ["Reference"] = "TXN-2",
            ["TransactionDate"] = "2026/04/15 09:00",
            ["AccountNumber"] = "1001-2034-5567",
            ["Description"] = "Row under test",
            ["Amount"] = "20",
            ["TransactionType"] = "D",
            ["Currency"] = "ZAR",
        };
        rowUnderTest[column] = value;
        rows.AddRow(rows.Header.Select(header => rowUnderTest[header]).ToArray());
        return uploader.UploadAndRememberAsync(TestFiles.ToCsv(rows), FileName);
    }
}
