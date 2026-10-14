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
            var reference = TableText.Unquote(row["reference"]);
            var createdAt = FileSeeder.ParseDateTime(Optional(row, "created at")) ?? clock.GetUtcNow();
            var id = await TestDatabase.InsertTransactionAsync(new SeedTransaction(
                FileId: await files.GetOrSeedFileIdAsync(Optional(row, "file") ?? DefaultFileName),
                Reference: reference,
                TransactionDate: DateTime.Parse(Optional(row, "date") ?? "2026-04-15 08:00:00", CultureInfo.InvariantCulture),
                AccountNumber: Optional(row, "account") ?? "1234567890",
                Description: Optional(row, "description") ?? "Seeded",
                Amount: decimal.Parse(Optional(row, "amount") ?? "10.00", CultureInfo.InvariantCulture),
                TransactionType: Optional(row, "type") ?? "Credit",
                Currency: Optional(row, "currency") ?? "ZAR",
                Status: Optional(row, "status") ?? "Imported",
                RejectionReason: Optional(row, "rejection reason"),
                CreatedBy: SystemUser,
                CreatedAt: createdAt,
                LastChangedBy: Optional(row, "last changed by") ?? SystemUser,
                LastChangedAt: FileSeeder.ParseDateTime(Optional(row, "last changed at")) ?? createdAt));
            _transactionIds[reference] = id;
        }
    }

    /// <summary>Seeds Imported transactions TXN-01, TXN-02, ... in one file, all with the same date.</summary>
    public async Task SeedManyAsync(int count, string date)
    {
        var fileId = await files.GetOrSeedFileIdAsync(DefaultFileName);
        var now = clock.GetUtcNow();
        for (var number = 1; number <= count; number++)
        {
            var reference = $"TXN-{number:D2}";
            _transactionIds[reference] = await TestDatabase.InsertTransactionAsync(new SeedTransaction(
                fileId, reference, DateTime.Parse(date, CultureInfo.InvariantCulture), "1234567890", "Seeded", 10.00m,
                "Credit", "ZAR", "Imported", null, SystemUser, now, SystemUser, now));
        }
    }

    private static string? Optional(DataTableRow row, string column) =>
        row.TryGetValue(column, out var value) && value.Length > 0 ? TableText.Unquote(value) : null;
}
