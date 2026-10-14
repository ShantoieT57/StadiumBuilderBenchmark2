using System.Globalization;
using Reqnroll;

namespace BenchmarkApp2.Tests.Support;

/// <summary>
/// Stores files and their transactions directly in the test database, in the order given, and
/// remembers the id of each file by its name. Stands in for uploads and processing when a scenario
/// only needs files to exist in a particular state.
/// </summary>
public sealed class FileSeeder(ManualTimeProvider clock)
{
    private const string DefaultInvalidRowsReason = "Some rows are invalid.";

    private readonly Dictionary<string, Guid> _fileIds = [];

    /// <summary>The ids of the seeded files, in the order they were stored (received).</summary>
    public List<Guid> FileIdsInReceivedOrder { get; } = [];

    public Guid GetFileId(string fileName) =>
        _fileIds.TryGetValue(fileName, out var id)
            ? id
            : throw new InvalidOperationException($"No file named \"{fileName}\" was seeded in this scenario.");

    /// <summary>
    /// Seeds one file per table row. Only the <c>name</c> column is required. Optional columns:
    /// <c>status</c> (Completed), <c>failure kind</c> (InvalidRows for a Failed file),
    /// <c>failure reason</c>, <c>last processed</c> (ISO 8601; empty for never processed),
    /// <c>rows</c> (empty for unknown), <c>imported</c> / <c>approved</c> / <c>rejected</c>
    /// transaction counts (0) and <c>cancelled</c> (yes / no).
    /// </summary>
    public async Task SeedAsync(DataTable files)
    {
        foreach (var row in files.Rows)
        {
            var status = Optional(row, "status") ?? "Completed";
            var isFailed = status == "Failed";
            await SeedAsync(
                new SeedFile(
                    FileName: row["name"],
                    Status: status,
                    FailureKind: isFailed ? Optional(row, "failure kind") ?? "InvalidRows" : null,
                    FailureReason: isFailed ? Optional(row, "failure reason") ?? DefaultInvalidRowsReason : null,
                    LastProcessedAt: ParseDateTime(Optional(row, "last processed")),
                    RowCount: Optional(row, "rows") is { } rows ? int.Parse(rows, CultureInfo.InvariantCulture) : null,
                    IsCancelled: Optional(row, "cancelled") == "yes"),
                imported: Count(row, "imported"),
                approved: Count(row, "approved"),
                rejected: Count(row, "rejected"));
        }
    }

    /// <summary>Seeds a file and the given number of transactions in each status.</summary>
    public async Task SeedAsync(SeedFile file, int imported = 0, int approved = 0, int rejected = 0)
    {
        var now = clock.GetUtcNow();
        var id = await TestDatabase.InsertFileAsync(file, now);
        _fileIds[file.FileName] = id;
        FileIdsInReceivedOrder.Add(id);

        await TestDatabase.InsertTransactionsAsync(id, "Imported", imported, now);
        await TestDatabase.InsertTransactionsAsync(id, "Approved", approved, now);
        await TestDatabase.InsertTransactionsAsync(id, "Rejected", rejected, now);
    }

    /// <summary>Reads an ISO 8601 date and time; one without an offset is taken as UTC.</summary>
    public static DateTimeOffset? ParseDateTime(string? value) =>
        string.IsNullOrEmpty(value)
            ? null
            : DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal).ToUniversalTime();

    private static string? Optional(DataTableRow row, string column) =>
        row.TryGetValue(column, out var value) && value.Length > 0 ? value : null;

    private static int Count(DataTableRow row, string column) =>
        Optional(row, column) is { } value ? int.Parse(value, CultureInfo.InvariantCulture) : 0;
}
