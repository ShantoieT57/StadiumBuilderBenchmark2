using BenchmarkApp2.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Sends transactions as a CSV attachment (EX-01, EX-06), writing each row as it is read from the
/// database, so a large export is never held in memory. The file name is sent both as
/// <c>filename</c> and, UTF-8 encoded, as <c>filename*</c> (RFC 6266).
/// </summary>
public sealed class TransactionCsvResult(IAsyncEnumerable<TransactionDetailsRow> rows, string fileName, TimeZoneInfo timeZone) : IActionResult
{
    private const int WriteBufferSize = 64 * 1024;

    public async Task ExecuteResultAsync(ActionContext context)
    {
        var response = context.HttpContext.Response;
        response.ContentType = TransactionCsv.ContentType;
        var disposition = new ContentDispositionHeaderValue("attachment");
        disposition.SetHttpFileName(fileName);
        response.Headers.ContentDisposition = disposition.ToString();

        await response.Body.WriteAsync(TransactionCsv.ByteOrderMark.ToArray(), context.HttpContext.RequestAborted);
        await using var writer = new StreamWriter(response.Body, TransactionCsv.Encoding, WriteBufferSize, leaveOpen: true);
        await writer.WriteAsync(TransactionCsv.HeaderRecord);
        await foreach (var row in rows)
        {
            await writer.WriteAsync(TransactionCsv.ToRecord(row, timeZone));
        }
        await writer.FlushAsync(context.HttpContext.RequestAborted);
    }
}
