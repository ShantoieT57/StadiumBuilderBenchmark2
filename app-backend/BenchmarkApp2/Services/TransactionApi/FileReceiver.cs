using System.Security.Cryptography;
using BenchmarkApp2.Data;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>Why an uploaded file was refused before it was received.</summary>
public enum UploadRefusal
{
    None,
    InvalidFileName,
    NotCsvFile,
}

/// <summary>A file that has been received and is waiting to be processed.</summary>
public sealed record ReceivedFile(Guid Id, string FileName, FileKind Kind, DateTimeOffset UploadedAt);

/// <summary>
/// Stage 1 of processing a file (Receive, UP-07): checks the uploaded file's name and type, then keeps
/// the exact original bytes, their SHA-256 hash, who uploaded the file and when, with the status
/// Uploaded. Nothing in the file is read; the file is checked and loaded later, in the background.
/// </summary>
public sealed class FileReceiver(FileRepository files, TimeProvider timeProvider)
{
    private const int MaxFileNameLength = 255;
    private const string CsvExtension = ".csv";

    /// <summary>
    /// Checks the file name exactly as the client sent it (UP-04), then that it is a .csv file
    /// (UP-03), ignoring upper and lower case.
    /// </summary>
    public static UploadRefusal Check(string fileName)
    {
        if (fileName.Length is 0 or > MaxFileNameLength
            || fileName.Contains("..", StringComparison.Ordinal)
            || fileName.IndexOfAny(['\\', '/', ':']) >= 0)
        {
            return UploadRefusal.InvalidFileName;
        }

        return fileName.EndsWith(CsvExtension, StringComparison.OrdinalIgnoreCase)
            ? UploadRefusal.None
            : UploadRefusal.NotCsvFile;
    }

    /// <summary>Stores a file that has passed <see cref="Check"/>.</summary>
    public async Task<ReceivedFile> ReceiveAsync(string fileName, FileKind kind, Stream data, Guid uploadedBy, CancellationToken cancellationToken)
    {
        using var memory = new MemoryStream();
        await data.CopyToAsync(memory, cancellationToken);
        var content = memory.ToArray();
        var uploadedAt = timeProvider.GetUtcNow();

        var id = await files.InsertUploadedAsync(
            new NewFileRecord(fileName, kind.ToString(), content, SHA256.HashData(content), uploadedBy, uploadedAt),
            cancellationToken);
        return new ReceivedFile(id, fileName, kind, uploadedAt);
    }
}
