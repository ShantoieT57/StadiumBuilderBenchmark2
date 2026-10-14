using System.Globalization;
using Reqnroll;

namespace BenchmarkApp2.Tests.Support;

/// <summary>
/// Stores transactions with exact values directly in the test database and remembers the id of each
/// by its reference. A transaction's file is seeded as an active Completed file when no file of that
/// name has been seeded yet in the scenario.
/// </summary>
public sealed class TransactionSeeder(FileSeeder files, ManualTimeProvider clock)
{
    private const string DefaultFileName = "transactions.csv";
    private const string DefaultDate = "2026-04-15 08:00:00";
    private const string DefaultAccount = "1234567890";
    private const string DefaultDescription = "Seeded";
    private const decimal DefaultAmount = 10.00m;
    private const string DefaultCurrency = "ZAR";
    private const string DefaultType = "Credit";
    private const string DefaultStatus = "Imported";
    private const string SystemUser = "System";

    private readonly Dictionary<string, Guid> _transactionIds = [];

    public Guid GetTransactionId(string reference) =>
        _transactionIds.TryGetValue(reference, out var id)
            ? id
            : throw new InvalidOperationException($"No transaction with the reference \"{reference}\" was seeded in this scenario.");

    /// <summary>
    /// Seeds one transaction per table row. Only the <c>reference</c> column is required. Optional
    /// columns and their defaults: <c>date</c> (2026-04-15 08:00:00, no time zone), <c>account</c>
    /// (1234567890), <c>description</c> (Seeded), <c>amount</c> (10.00), <c>currency</c> (ZAR),
    /// <c>type</c> (Credit), <c>status</c> (Imported), <c>file</c> (transactions.csv),
    /// <c>rejection reason</c> (none), <c>created at</c> (now), <c>last changed by</c> (System) and
    /// <c>last changed at</c> (the created time).
    /// </summary>
    public async Task SeedAsync(DataTable transactions)
    {
        foreach (var row in transactions.Rows)
        {
            var createdAt = FileSeeder.ParseDateTime(Optional(row, "created at")) ?? clock.GetUtcNow();
            await SeedAsync(
                reference: TableText.Unquote(row["reference"]),
                fileName: Optional(row, "file") ?? DefaultFileName,
                transactionDate: DateTime.Parse(Optional(row, "date") ?? DefaultDate, CultureInfo.InvariantCulture),
                accountNumber: Optional(row, "account") ?? DefaultAccount,
                description: Optional(row, "description") ?? DefaultDescription,
                amount: Optional(row, "amount") is { } amount ? decimal.Parse(amount, CultureInfo.InvariantCulture) : DefaultAmount,
                currency: Optional(row, "currency") ?? DefaultCurrency,
                transactionType: Optional(row, "type") ?? DefaultType,
                status: Optional(row, "status") ?? DefaultStatus,
                rejectionReason: Optional(row, "rejection reason"),
                createdAt: createdAt,
                lastChangedBy: Optional(row, "last changed by") ?? SystemUser,
                lastChangedAt: FileSeeder.ParseDateTime(Optional(row, "last changed at")) ?? createdAt);
        }
    }

    /// <summary>Seeds one transaction with the given description, exactly as given, and defaults for the rest.</summary>
    public Task SeedWithDescriptionAsync(string reference, string description) =>
        SeedAsync(reference, DefaultFileName, DateTime.Parse(DefaultDate, CultureInfo.InvariantCulture), DefaultAccount, description,
            DefaultAmount, DefaultCurrency, DefaultType, DefaultStatus, rejectionReason: null, clock.GetUtcNow(), SystemUser, clock.GetUtcNow());

    /// <summary>Seeds Imported transactions TXN-01, TXN-02, ... in one file, all with the same date.</summary>
    public async Task SeedManyAsync(int count, string date)
    {
        var now = clock.GetUtcNow();
        for (var number = 1; number <= count; number++)
        {
            await SeedAsync($"TXN-{number:D2}", DefaultFileName, DateTime.Parse(date, CultureInfo.InvariantCulture), DefaultAccount,
                DefaultDescription, DefaultAmount, DefaultCurrency, DefaultType, DefaultStatus, rejectionReason: null, now, SystemUser, now);
        }
    }

    /// <summary>
    /// Seeds transactions TXN-001, TXN-002, ... whose values vary in every column, deterministically:
    /// for transaction n, the status cycles Approved, Rejected, Imported (n mod 3 = 2, 0, 1); n 1-20
    /// are in batch-1.csv, 21-40 in batch-2.csv and so on; the date is (7n mod 30) days after
    /// 2026-04-01 at 08:00 plus (n mod 5) hours, so each day of April holds exactly two of 60; and
    /// the amount is (37n mod 100) x 10 + 0.25, different for each of 100.
    /// </summary>
    public async Task SeedVariedAsync(int count)
    {
        string[] statuses = ["Rejected", "Imported", "Approved"];
        string[] currencies = ["ZAR", "USD", "EUR", "GBP"];
        var now = clock.GetUtcNow();
        for (var n = 1; n <= count; n++)
        {
            var status = statuses[n % 3];
            await SeedAsync(
                reference: $"TXN-{n:D3}",
                fileName: $"batch-{(n - 1) / 20 + 1}.csv",
                transactionDate: new DateTime(2026, 4, 1, 8, 0, 0).AddDays(n * 7 % 30).AddHours(n % 5),
                accountNumber: (10_000_000 + n * 13).ToString(CultureInfo.InvariantCulture),
                description: $"Payment {n}",
                amount: n * 37 % 100 * 10 + 0.25m,
                currency: currencies[n % 4],
                transactionType: n % 2 == 0 ? "Debit" : "Credit",
                status: status,
                rejectionReason: status == "Rejected" ? $"Reason {n}" : null,
                createdAt: now,
                lastChangedBy: status == DefaultStatus ? SystemUser : "Approver User",
                lastChangedAt: now);
        }
    }

    private async Task SeedAsync(
        string reference,
        string fileName,
        DateTime transactionDate,
        string accountNumber,
        string description,
        decimal amount,
        string currency,
        string transactionType,
        string status,
        string? rejectionReason,
        DateTimeOffset createdAt,
        string lastChangedBy,
        DateTimeOffset lastChangedAt)
    {
        _transactionIds[reference] = await TestDatabase.InsertTransactionAsync(new SeedTransaction(
            FileId: await files.GetOrSeedFileIdAsync(fileName),
            Reference: reference,
            TransactionDate: transactionDate,
            AccountNumber: accountNumber,
            Description: description,
            Amount: amount,
            TransactionType: transactionType,
            Currency: currency,
            Status: status,
            RejectionReason: rejectionReason,
            CreatedBy: SystemUser,
            CreatedAt: createdAt,
            LastChangedBy: lastChangedBy,
            LastChangedAt: lastChangedAt));
    }

    private static string? Optional(DataTableRow row, string column) =>
        row.TryGetValue(column, out var value) && value.Length > 0 ? TableText.Unquote(value) : null;
}
