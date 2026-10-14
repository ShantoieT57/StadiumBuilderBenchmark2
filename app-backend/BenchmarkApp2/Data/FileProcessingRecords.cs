namespace BenchmarkApp2.Data;

/// <summary>A claimed file and its original content, read for processing.</summary>
public sealed record FileToProcess(Guid Id, string FileName, byte[] Content);

/// <summary>
/// A transaction row exactly as read from a file. <see cref="RowNumber"/> counts transaction rows
/// from 1, not counting the header. Missing columns are empty, and values beyond the seven
/// expected columns are kept in <see cref="ExtraValues"/>.
/// </summary>
public sealed record FileRowValues(
    int RowNumber,
    string Reference,
    string TransactionDate,
    string AccountNumber,
    string Description,
    string Amount,
    string TransactionType,
    string Currency,
    int ColumnCount,
    IReadOnlyList<string> ExtraValues)
{
    /// <summary>A row with an empty reference is ignored, not checked or loaded.</summary>
    public bool HasReference => !string.IsNullOrWhiteSpace(Reference);
}

/// <summary>A row kept for corrections, with every reason it failed (empty when it is valid or ignored).</summary>
public sealed record FileRowRecord(FileRowValues Values, IReadOnlyList<string> Reasons);

/// <summary>
/// A row kept for corrections as stored, with its stable id. A class rather than a record, because
/// Dapper reads a <c>text[]</c> column into a property but not into a constructor parameter.
/// </summary>
public sealed class KeptFileRow
{
    public Guid Id { get; init; }
    public int RowNumber { get; init; }
    public string Reference { get; init; } = string.Empty;
    public string TransactionDate { get; init; } = string.Empty;
    public string AccountNumber { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string Amount { get; init; } = string.Empty;
    public string TransactionType { get; init; } = string.Empty;
    public string Currency { get; init; } = string.Empty;
    public int ColumnCount { get; init; }
    public string[] ExtraValues { get; init; } = [];
    public string[] Reasons { get; init; } = [];

    public bool IsInvalid => Reasons.Length > 0;

    public FileRowValues ToValues() => new(
        RowNumber, Reference, TransactionDate, AccountNumber, Description, Amount, TransactionType, Currency, ColumnCount, ExtraValues);
}

/// <summary>A valid row converted into the values a transaction is loaded with.</summary>
public sealed record NewTransactionRecord(
    string Reference,
    DateTime TransactionDate,
    string AccountNumber,
    string Description,
    decimal Amount,
    string TransactionType,
    string Currency);

/// <summary>How the rows of a loaded file were handled (FP-07). The three counts add up to its row count.</summary>
public sealed record FileLoadCounts(int Loaded, int SkippedExisting, int IgnoredEmptyReference);

/// <summary>The stages of processing a file, in order, as stored in <c>file_processing_stages.stage</c>.</summary>
public enum ProcessingStage
{
    Receive,
    DuplicateCheck,
    ReadRows,
    ConvertTypes,
    CheckRows,
    WaitForCorrections,
    Load,
}

/// <summary>Why a file failed, as stored in <c>files.failure_kind</c>.</summary>
public enum FileFailureKind
{
    /// <summary>The file is a duplicate of an earlier file. It stays failed (FS-01).</summary>
    Duplicate,

    /// <summary>The file has invalid rows and waits for corrections (FS-02).</summary>
    InvalidRows,
}
