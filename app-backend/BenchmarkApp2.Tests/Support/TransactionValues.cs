using System.Globalization;

namespace BenchmarkApp2.Tests.Support;

/// <summary>Reads loaded transactions and formats their values the way the scenarios write them.</summary>
public static class TransactionValues
{
    /// <summary>A date and time as "yyyy-MM-dd HH:mm:ss", with any fraction of a second after it.</summary>
    public static string FormatDate(DateTime value) => value.ToString("yyyy-MM-dd HH:mm:ss.FFFFFFF", CultureInfo.InvariantCulture);

    public static async Task<StoredTransaction> GetByReferenceAsync(string reference) =>
        Assert.Single(await TestDatabase.GetTransactionsAsync(), transaction => transaction.Reference == reference);
}
