using System.Globalization;
using System.Text.Json;
using Reqnroll;

namespace BenchmarkApp2.Tests.Support;

/// <summary>Reads a list of invalid rows from a response and compares it with a scenario table.</summary>
public static class InvalidRowLists
{
    private const string ReasonSeparator = "; ";

    /// <summary>Reads the response exactly as sent: camelCase names, matched case-sensitively.</summary>
    private static readonly JsonSerializerOptions ResponseJson = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static InvalidRowListResponse Read(JsonElement list) =>
        list.Deserialize<InvalidRowListResponse>(ResponseJson)
        ?? throw new InvalidOperationException("The response holds no list of invalid rows.");

    /// <summary>
    /// Asserts the rows are exactly those in the table, in order. Values that must keep surrounding
    /// spaces are written between single quotes; reasons are separated by "; ".
    /// </summary>
    public static void AssertRows(DataTable expected, InvalidRowListResponse list)
    {
        Assert.Equal(expected.RowCount, list.Rows.Count);
        foreach (var (row, actual) in expected.Rows.Zip(list.Rows))
        {
            Assert.Equal(int.Parse(row["Row"], CultureInfo.InvariantCulture), actual.RowNumber);
            Assert.Equal(TableText.Unquote(row["Reference"]), actual.Reference);
            Assert.Equal(TableText.Unquote(row["TransactionDate"]), actual.TransactionDate);
            Assert.Equal(TableText.Unquote(row["AccountNumber"]), actual.AccountNumber);
            Assert.Equal(TableText.Unquote(row["Description"]), actual.Description);
            Assert.Equal(TableText.Unquote(row["Amount"]), actual.Amount);
            Assert.Equal(TableText.Unquote(row["TransactionType"]), actual.TransactionType);
            Assert.Equal(TableText.Unquote(row["Currency"]), actual.Currency);
            Assert.Equal(row["Reasons"], string.Join(ReasonSeparator, actual.Reasons));
        }
    }

    public sealed record InvalidRowListResponse(int TotalCount, List<InvalidRowResponse> Rows);

    public sealed record InvalidRowResponse(
        Guid Id,
        int RowNumber,
        string Reference,
        string TransactionDate,
        string AccountNumber,
        string Description,
        string Amount,
        string TransactionType,
        string Currency,
        List<string> Reasons);
}
