using System.Globalization;
using Reqnroll;

namespace BenchmarkApp2.Tests.Support;

/// <summary>
/// Sends corrections of a file's invalid rows as the signed-in person. Rows are named in scenarios by
/// their row number and sent by their stable id. The ids of a file's rows are read once and then
/// remembered for the scenario, so they stay known after a file is loaded and its kept rows are gone.
/// </summary>
public sealed class CorrectionClient(TransactionApiFixture api, ApiScenarioState state)
{
    private readonly Dictionary<Guid, IReadOnlyDictionary<int, Guid>> _rowIds = [];

    /// <summary>The ids of the file's kept rows by row number, as first read in this scenario.</summary>
    public async Task<IReadOnlyDictionary<int, Guid>> GetRowIdsAsync(Guid fileId)
    {
        if (!_rowIds.TryGetValue(fileId, out var ids))
        {
            ids = (await TestDatabase.GetFileRowsAsync(fileId)).ToDictionary(row => row.RowNumber, row => row.Id);
            _rowIds[fileId] = ids;
        }
        return ids;
    }

    public async Task<Guid> GetRowIdAsync(Guid fileId, int rowNumber) => (await GetRowIdsAsync(fileId))[rowNumber];

    /// <summary>
    /// One correction per table row: the <c>Row</c> column names the row and the seven column values
    /// replace its values. Values that must keep surrounding spaces are written between single quotes.
    /// </summary>
    public async Task<List<object>> ToCorrectionsAsync(Guid fileId, DataTable table)
    {
        var corrections = new List<object>();
        foreach (var row in table.Rows)
        {
            var id = await GetRowIdAsync(fileId, int.Parse(row["Row"], CultureInfo.InvariantCulture));
            corrections.Add(new
            {
                id,
                reference = TableText.Unquote(row["Reference"]),
                transactionDate = TableText.Unquote(row["TransactionDate"]),
                accountNumber = TableText.Unquote(row["AccountNumber"]),
                description = TableText.Unquote(row["Description"]),
                amount = TableText.Unquote(row["Amount"]),
                transactionType = TableText.Unquote(row["TransactionType"]),
                currency = TableText.Unquote(row["Currency"]),
            });
        }
        return corrections;
    }

    /// <summary>A complete, well-formed correction of the row with the id.</summary>
    public static object ValidCorrection(Guid id) => new
    {
        id,
        reference = "FIX-1",
        transactionDate = "2026/04/15 08:12",
        accountNumber = "1001",
        description = "Corrected",
        amount = "10",
        transactionType = "C",
        currency = "ZAR",
    };

    public Task<HttpResponseMessage> SendRecheckAsync(Guid fileId, IEnumerable<object> corrections) =>
        api.SendAsync(HttpMethod.Post, $"files/{fileId}/recheck", new { corrections }, state.SessionCookie);

    public async Task RecheckAsync(Guid fileId, IEnumerable<object> corrections) =>
        await state.RecordResponseAsync(await SendRecheckAsync(fileId, corrections));

    public async Task SaveAsync(Guid fileId, IEnumerable<object> rows) =>
        await state.RecordResponseAsync(await api.SendAsync(HttpMethod.Patch, $"files/{fileId}/invalid-rows", new { rows }, state.SessionCookie));

    /// <summary>Re-checks the file with exactly this JSON body; see <see cref="WithRowIdsAsync"/>.</summary>
    public async Task RecheckWithBodyAsync(Guid fileId, string jsonBody) =>
        await state.RecordResponseAsync(await api.SendJsonTextAsync(
            HttpMethod.Post, $"files/{fileId}/recheck", await WithRowIdsAsync(fileId, jsonBody), state.SessionCookie));

    /// <summary>Saves corrections to the file with exactly this JSON body; see <see cref="WithRowIdsAsync"/>.</summary>
    public async Task SaveWithBodyAsync(Guid fileId, string jsonBody) =>
        await state.RecordResponseAsync(await api.SendJsonTextAsync(
            HttpMethod.Patch, $"files/{fileId}/invalid-rows", await WithRowIdsAsync(fileId, jsonBody), state.SessionCookie));

    /// <summary>The body with each <c>{row N}</c> replaced by the id of the file's row N.</summary>
    private async Task<string> WithRowIdsAsync(Guid fileId, string jsonBody)
    {
        foreach (var (rowNumber, id) in await GetRowIdsAsync(fileId))
        {
            jsonBody = jsonBody.Replace($"{{row {rowNumber}}}", id.ToString(), StringComparison.Ordinal);
        }
        return jsonBody;
    }
}
