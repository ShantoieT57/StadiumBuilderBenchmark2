using BenchmarkApp2.Data;

namespace BenchmarkApp2.Services.FileProcessor;

/// <summary>The corrected values of one invalid row, identified by its stable id. All seven columns are given.</summary>
public sealed record CorrectedRow(
    Guid Id,
    string Reference,
    string TransactionDate,
    string AccountNumber,
    string Description,
    string Amount,
    string TransactionType,
    string Currency);

/// <summary>How a correction of a file turned out.</summary>
public enum CorrectionOutcome
{
    /// <summary>The corrections were saved; the file was not checked again.</summary>
    Saved,

    /// <summary>The file was checked again, every row passed and the file was loaded.</summary>
    Completed,

    /// <summary>The file was checked again and still has invalid rows.</summary>
    StillInvalid,

    FileNotFound,

    /// <summary>The file is not Failed because of invalid rows, or it is cancelled.</summary>
    NotWaitingForCorrections,

    /// <summary>A correction names a row that is not one of the file's invalid rows.</summary>
    NotAnInvalidRow,

    /// <summary>A row is corrected more than once in the same request.</summary>
    RowRepeated,
}

/// <summary>
/// Corrects the invalid rows of a file waiting for corrections (FC-02) and checks the file again
/// (FC-03), synchronously, so the importer sees the outcome straight away. All of it is one database
/// transaction in which the file row is locked: a correction waits for any correction or re-check of
/// the same file already under way, and then finds the file no longer waiting if that one loaded it.
/// The background processor only claims Uploaded files, so it never works on a file that waits for
/// corrections. Corrected rows are updated in place and keep their ids; the original uploaded file
/// is never changed (FD-05).
/// </summary>
public sealed class Corrector(FileProcessingRepository repository, TimeProvider timeProvider, ILogger<Corrector> logger)
{
    private readonly CheckAndLoadStages _checkAndLoad = new(timeProvider, logger);

    /// <summary>Saves the corrected values without checking the file again; the rows keep their last reasons.</summary>
    public Task<CorrectionOutcome> SaveAsync(Guid fileId, IReadOnlyList<CorrectedRow> corrections, CancellationToken cancellationToken) =>
        CorrectAsync(fileId, corrections, recheck: false, cancellationToken);

    /// <summary>
    /// Saves the corrected values and repeats stages 4 to 7 over every row of the file. The duplicate
    /// file check is not repeated. The open Wait for corrections stage is finished first.
    /// </summary>
    public Task<CorrectionOutcome> RecheckAsync(Guid fileId, IReadOnlyList<CorrectedRow> corrections, CancellationToken cancellationToken) =>
        CorrectAsync(fileId, corrections, recheck: true, cancellationToken);

    private async Task<CorrectionOutcome> CorrectAsync(Guid fileId, IReadOnlyList<CorrectedRow> corrections, bool recheck, CancellationToken cancellationToken)
    {
        if (corrections.DistinctBy(correction => correction.Id).Count() != corrections.Count)
        {
            return CorrectionOutcome.RowRepeated;
        }

        if (await repository.BeginCorrectionAsync(fileId, cancellationToken) is not { } started)
        {
            return CorrectionOutcome.FileNotFound;
        }
        await using var unit = started.Unit;
        if (!started.State.IsWaitingForCorrections)
        {
            return CorrectionOutcome.NotWaitingForCorrections;
        }

        var rows = await unit.GetRowsAsync(cancellationToken);
        var invalidRows = rows.Where(row => row.IsInvalid).ToDictionary(row => row.Id);
        if (corrections.Any(correction => !invalidRows.ContainsKey(correction.Id)))
        {
            return CorrectionOutcome.NotAnInvalidRow;
        }

        var correctedValues = corrections.ToDictionary(correction => correction.Id, correction => Apply(correction, invalidRows[correction.Id]));
        CorrectionOutcome outcome;
        if (recheck)
        {
            var history = new ProcessingHistory(unit, timeProvider, cancellationToken);
            await history.FinishAsync(ProcessingStage.WaitForCorrections);
            var values = rows.Select(row => correctedValues.GetValueOrDefault(row.Id) ?? row.ToValues()).ToList();
            var result = await _checkAndLoad.RunAsync(unit, history, values, cancellationToken);
            outcome = result.IsCompleted ? CorrectionOutcome.Completed : CorrectionOutcome.StillInvalid;
        }
        else
        {
            var saved = corrections.Select(correction => new FileRowRecord(correctedValues[correction.Id], invalidRows[correction.Id].Reasons)).ToList();
            await unit.SaveRowsAsync(saved, cancellationToken);
            outcome = CorrectionOutcome.Saved;
        }

        await unit.CommitAsync(cancellationToken);
        return outcome;
    }

    /// <summary>
    /// The row with the corrected values. A corrected row has exactly the seven expected columns, so
    /// any surplus values it had in the file are dropped.
    /// </summary>
    private static FileRowValues Apply(CorrectedRow correction, KeptFileRow row) => row.ToValues() with
    {
        Reference = TransactionFileReader.ToStorableText(correction.Reference),
        TransactionDate = TransactionFileReader.ToStorableText(correction.TransactionDate),
        AccountNumber = TransactionFileReader.ToStorableText(correction.AccountNumber),
        Description = TransactionFileReader.ToStorableText(correction.Description),
        Amount = TransactionFileReader.ToStorableText(correction.Amount),
        TransactionType = TransactionFileReader.ToStorableText(correction.TransactionType),
        Currency = TransactionFileReader.ToStorableText(correction.Currency),
        ColumnCount = TransactionFileReader.ColumnCount,
        ExtraValues = [],
    };
}
