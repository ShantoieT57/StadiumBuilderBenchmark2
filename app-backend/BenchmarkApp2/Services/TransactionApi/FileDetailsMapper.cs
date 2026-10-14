using BenchmarkApp2.Data;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>Turns what is stored about a file into the responses of the file detail endpoints.</summary>
public static class FileDetailsMapper
{
    /// <summary>
    /// The file's details (FD-01, FD-03, FD-06, FD-07) with its processing history (FD-04).
    /// A file is fully reviewed when it is Completed, not cancelled and none of its transactions is
    /// still Imported, so a Completed file with no transactions at all is fully reviewed: nothing
    /// from it awaits review. Transactions are available once processing has finished. The original
    /// can be downloaded until the file is cancelled, which discards it (FX-04).
    /// </summary>
    public static FileDetails ToFileDetails(FileDetailsRecord file, IReadOnlyList<ProcessingStageRecord> history)
    {
        var status = Enum.Parse<FileStatus>(file.Status);
        var isCancelled = file.CancelledAt is not null;
        return new FileDetails
        {
            Id = file.Id,
            FileName = file.FileName,
            Kind = Enum.Parse<FileKind>(file.Kind),
            Status = status,
            FailureKind = file.FailureKind is null ? null : Enum.Parse<FailureKind>(file.FailureKind),
            FailureReason = file.FailureReason,
            UploadedBy = file.UploadedBy,
            UploadedAt = AsUtc(file.UploadedAt),
            LastProcessedAt = AsUtc(file.LastProcessedAt),
            IsCancelled = isCancelled,
            CancelledAt = AsUtc(file.CancelledAt),
            RowCount = file.RowCount,
            LoadedCount = file.LoadedCount,
            SkippedExistingCount = file.SkippedExistingCount,
            IgnoredEmptyReferenceCount = file.IgnoredEmptyReferenceCount,
            Transactions = new TransactionStatusCounts
            {
                Imported = file.ImportedCount,
                Approved = file.ApprovedCount,
                Rejected = file.RejectedCount,
            },
            IsFullyReviewed = status == FileStatus.Completed && !isCancelled && file.ImportedCount == 0,
            AreTransactionsAvailable = status is not (FileStatus.Uploaded or FileStatus.Processing),
            CanDownload = CanDownload(file.HasContent, file.CancelledAt),
            ProcessingHistory = history.Select(stage => new ProcessingStageEntry
            {
                Stage = Enum.Parse<ProcessingStage>(stage.Stage),
                StartedAt = AsUtc(stage.StartedAt),
                FinishedAt = AsUtc(stage.FinishedAt),
            }).ToList(),
        };
    }

    public static InvalidRowList ToInvalidRowList(IReadOnlyList<InvalidRowRecord> rows) => new()
    {
        TotalCount = rows.Count,
        Rows = rows.Select(row => new InvalidRow
        {
            Id = row.Id,
            RowNumber = row.RowNumber,
            Reference = row.Reference,
            TransactionDate = row.TransactionDate,
            AccountNumber = row.AccountNumber,
            Description = row.Description,
            Amount = row.Amount,
            TransactionType = row.TransactionType,
            Currency = row.Currency,
            Reasons = row.Reasons,
        }).ToList(),
    };

    /// <summary>The original can be downloaded while it is kept, which is until the file is cancelled (FX-04).</summary>
    public static bool CanDownload(bool hasContent, DateTime? cancelledAt) => hasContent && cancelledAt is null;

    /// <summary>PostgreSQL returns <c>timestamptz</c> values as UTC.</summary>
    private static DateTimeOffset AsUtc(DateTime value) => new(DateTime.SpecifyKind(value, DateTimeKind.Utc));

    private static DateTimeOffset? AsUtc(DateTime? value) => value is { } time ? AsUtc(time) : null;
}
