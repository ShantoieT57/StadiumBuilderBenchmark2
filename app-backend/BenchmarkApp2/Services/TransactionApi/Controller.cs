using System.Security.Claims;
using BenchmarkApp2.Data;
using BenchmarkApp2.Services.FileProcessor;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// Implements the TransactionApi operations generated from docs/TransactionApi.yaml.
/// Every operation requires a signed-in session (the fallback policy) unless marked anonymous.
/// An operation limited to some roles uses <c>[Authorize(Roles = ...)]</c>; a signed-in person in
/// another role is refused with a JSON 403 (see <see cref="SessionAuthenticationHandler"/>).
/// </summary>
/// <remarks>
/// The empty route replaces the generated base controller's route, which NSwag derives from the
/// spec's server URL. Routes must stay relative to the path base configured at runtime instead.
/// </remarks>
[ApiController]
[Route("")]
public sealed class Controller(
    SessionManager sessionManager,
    FileReceiver fileReceiver,
    DashboardRepository dashboardRepository,
    FileDetailsRepository fileDetailsRepository,
    FileCancellationRepository fileCancellationRepository,
    Corrector corrector,
    TransactionRepository transactionRepository,
    TransactionReviewRepository transactionReviewRepository,
    TimeProvider timeProvider,
    AppSettings settings) : ControllerBase
{
    private const string CsvContentType = "text/csv";
    private const string FileNotFoundMessage = "File not found";
    private const string TransactionNotFoundMessage = "Transaction not found";
    private const string FileContentDiscardedMessage = "The original file is no longer available because the file has been cancelled.";
    private const string NotWaitingForCorrectionsMessage = "This file is not waiting for corrections.";
    private const string NotAnInvalidRowMessage = "Only the file's invalid rows can be corrected.";
    private const string RowRepeatedMessage = "Each row can be corrected only once in a request.";
    private const string InvalidCredentialsMessage = "Invalid email or password";
    private const string InvalidFileNameMessage = "Invalid file name";
    private const string NotCsvFileMessage = "Only .csv files can be uploaded. Please choose a .csv file.";
    private const string NoMatchesToExportMessage = "No transactions match the current filters, so there is nothing to export.";
    private const string NoTransactionsToExportMessage = "There are no transactions yet, so there is nothing to export.";

    /// <summary>Why a transaction that is no longer Imported was not changed, naming its status (AP-04, RJ-05).</summary>
    private static string AlreadyReviewedMessage(string status) => $"This transaction has already been {status.ToLowerInvariant()}.";

    /// <summary>Why a file with Approved transactions cannot be cancelled (FX-02), with how many there are.</summary>
    private static string HasApprovedTransactionsMessage(int approvedCount) => approvedCount == 1
        ? "This file cannot be cancelled because 1 of its transactions has been approved."
        : $"This file cannot be cancelled because {approvedCount} of its transactions have been approved.";

    [AllowAnonymous]
    public override async Task<ActionResult<CurrentUser>> SignIn(SignInRequest body, CancellationToken cancellationToken = default)
    {
        var session = await sessionManager.SignInAsync(body.Email, body.Password, cancellationToken);
        if (session is null)
        {
            return Unauthorized(new ErrorResponse { Message = InvalidCredentialsMessage });
        }

        SessionCookie.Append(Response, session.Token);
        return ToCurrentUser(session.User.Name, session.User.Email, session.User.Role);
    }

    public override Task<ActionResult<CurrentUser>> GetCurrentUser(CancellationToken cancellationToken = default)
    {
        var currentUser = ToCurrentUser(
            User.FindFirstValue(ClaimTypes.Name)!,
            User.FindFirstValue(ClaimTypes.Email)!,
            User.FindFirstValue(ClaimTypes.Role)!);
        return Task.FromResult<ActionResult<CurrentUser>>(currentUser);
    }

    /// <summary>Anonymous and idempotent, so a person can always sign out even with an ended session.</summary>
    [AllowAnonymous]
    public override async Task<IActionResult> SignOut(CancellationToken cancellationToken = default)
    {
        if (SessionCookie.TryRead(Request, out var token))
        {
            await sessionManager.SignOutAsync(token, cancellationToken);
        }

        SessionCookie.Delete(Response);
        return NoContent();
    }

    /// <summary>
    /// Importers only. Over-sized files are refused by <see cref="UploadSizeLimitFilter"/> before
    /// the form is bound.
    /// </summary>
    [Authorize(Roles = nameof(UserRole.Importer))]
    [TypeFilter(typeof(UploadSizeLimitFilter))]
    public override async Task<ActionResult<UploadedFile>> UploadFile(
        [ModelBinder(typeof(FileParameterModelBinder)), BindRequired] FileParameter? file = null,
        [FromForm] FileKind? kind = FileKind.BankTransactions,
        CancellationToken cancellationToken = default)
    {
        var fileName = file!.FileName ?? string.Empty;
        switch (FileReceiver.Check(fileName))
        {
            case UploadRefusal.InvalidFileName:
                return BadRequest(new ErrorResponse { Message = InvalidFileNameMessage });
            case UploadRefusal.NotCsvFile:
                return BadRequest(new ErrorResponse { Message = NotCsvFileMessage });
        }

        var received = await fileReceiver.ReceiveAsync(
            fileName,
            kind ?? FileKind.BankTransactions,
            file.Data,
            CurrentUserId,
            cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new UploadedFile
        {
            Id = received.Id,
            FileName = received.FileName,
            Kind = received.Kind,
            Status = FileStatus.Uploaded,
            UploadedAt = received.UploadedAt,
        });
    }

    /// <summary>Both roles. Counts over every file that is not cancelled (DB-01).</summary>
    public override async Task<ActionResult<DashboardSummary>> GetDashboardSummary(CancellationToken cancellationToken = default)
    {
        var counts = await dashboardRepository.GetCountsAsync(cancellationToken);
        return new DashboardSummary
        {
            Files = new FileStatusCounts
            {
                Uploaded = counts.FilesByStatus.GetValueOrDefault(FileStatusValue.Uploaded),
                Processing = counts.FilesByStatus.GetValueOrDefault(FileStatusValue.Processing),
                Completed = counts.FilesByStatus.GetValueOrDefault(FileStatusValue.Completed),
                Failed = counts.FilesByStatus.GetValueOrDefault(FileStatusValue.Failed),
            },
            Transactions = new TransactionStatusCounts
            {
                Imported = counts.TransactionsByStatus.GetValueOrDefault(TransactionStatusValue.Imported),
                Approved = counts.TransactionsByStatus.GetValueOrDefault(TransactionStatusValue.Approved),
                Rejected = counts.TransactionsByStatus.GetValueOrDefault(TransactionStatusValue.Rejected),
            },
        };
    }

    /// <summary>
    /// Both roles. Values the binder cannot read (unknown enum values, unreadable dates) are refused
    /// with a 400 before this runs; <see cref="FileListQuery"/> checks the rest.
    /// </summary>
    public override async Task<ActionResult<FilePage>> ListFiles(
        int? page = 1,
        int? pageSize = 20,
        FileSortColumn? sortBy = null,
        SortDirection? sortDirection = null,
        FileStatus? status = null,
        string? fileName = null,
        DateTimeOffset? processedFrom = null,
        DateTimeOffset? processedTo = null,
        FileVisibility? visibility = null,
        CancellationToken cancellationToken = default)
    {
        var query = FileListQuery.Create(
            page, pageSize, sortBy, sortDirection, status, fileName, processedFrom, processedTo, visibility, ModelState);
        if (query is null)
        {
            return ValidationProblem(ModelState);
        }

        var files = await dashboardRepository.ListFilesAsync(query.ToCriteria(), cancellationToken);
        return query.ToFilePage(files);
    }

    /// <summary>Both roles, for active and cancelled files. The processing history is part of the details.</summary>
    public override Task<ActionResult<FileDetails>> GetFile(Guid fileId, CancellationToken cancellationToken = default) =>
        GetFileDetailsAsync(fileId, cancellationToken);

    /// <summary>
    /// Both roles. Returns the exact uploaded bytes as text/csv with no charset, since the file's
    /// encoding is never assumed. <see cref="ControllerBase.File(byte[], string, string)"/> sends
    /// the name both as <c>filename</c> and, UTF-8 encoded, as <c>filename*</c> (RFC 6266). Once
    /// the original has been discarded by cancelling the file, the download is gone (410).
    /// </summary>
    public override async Task<IActionResult> DownloadFile(Guid fileId, CancellationToken cancellationToken = default)
    {
        var file = await fileDetailsRepository.GetContentAsync(fileId, cancellationToken);
        if (file is null)
        {
            return FileNotFound();
        }
        if (!FileDetailsMapper.CanDownload(file.Content is not null, file.CancelledAt))
        {
            return StatusCode(StatusCodes.Status410Gone, new ErrorResponse { Message = FileContentDiscardedMessage });
        }

        return File(file.Content!, CsvContentType, file.FileName);
    }

    /// <summary>Importers only, for a file waiting for corrections (FC-01).</summary>
    [Authorize(Roles = nameof(UserRole.Importer))]
    public override async Task<ActionResult<InvalidRowList>> ListInvalidRows(Guid fileId, CancellationToken cancellationToken = default)
    {
        var file = await fileDetailsRepository.GetCorrectionStateAsync(fileId, cancellationToken);
        if (file is null)
        {
            return FileNotFound();
        }
        if (!file.IsWaitingForCorrections)
        {
            return Conflict(new ErrorResponse { Message = NotWaitingForCorrectionsMessage });
        }

        var rows = await fileDetailsRepository.GetInvalidRowsAsync(fileId, cancellationToken);
        return FileDetailsMapper.ToInvalidRowList(rows);
    }

    /// <summary>Importers only. Saves corrected values on invalid rows without checking the file again (FC-02).</summary>
    [Authorize(Roles = nameof(UserRole.Importer))]
    public override async Task<ActionResult<InvalidRowList>> SaveCorrections(Guid fileId, RowCorrections body, CancellationToken cancellationToken = default)
    {
        var outcome = await corrector.SaveAsync(fileId, ToCorrectedRows(body.Rows), cancellationToken);
        if (RefuseCorrection(outcome) is { } refusal)
        {
            return refusal;
        }

        return FileDetailsMapper.ToInvalidRowList(await fileDetailsRepository.GetInvalidRowsAsync(fileId, cancellationToken));
    }

    /// <summary>
    /// Importers only. Saves any corrections and checks the file again in the request (FC-02, FC-03),
    /// then returns the file as it now is and the rows that still fail.
    /// </summary>
    [Authorize(Roles = nameof(UserRole.Importer))]
    public override async Task<ActionResult<RecheckResult>> RecheckFile(Guid fileId, RecheckRequest body, CancellationToken cancellationToken = default)
    {
        var outcome = await corrector.RecheckAsync(fileId, ToCorrectedRows(body.Corrections), cancellationToken);
        if (RefuseCorrection(outcome) is { } refusal)
        {
            return refusal;
        }

        var file = await LoadFileDetailsAsync(fileId, cancellationToken);
        var stillInvalid = outcome == CorrectionOutcome.StillInvalid
            ? await fileDetailsRepository.GetInvalidRowsAsync(fileId, cancellationToken)
            : [];
        return new RecheckResult
        {
            Status = outcome == CorrectionOutcome.Completed ? FileStatus.Completed : FileStatus.Failed,
            File = file!,
            InvalidRows = FileDetailsMapper.ToInvalidRowList(stillInvalid),
        };
    }

    /// <summary>
    /// Importers only (FD-08). Cancels the file, or leaves an already cancelled file as it is (FX-06),
    /// and returns its details. A file with Approved transactions is refused with 409 (FX-02).
    /// </summary>
    [Authorize(Roles = nameof(UserRole.Importer))]
    public override async Task<ActionResult<FileDetails>> CancelFile(Guid fileId, CancellationToken cancellationToken = default)
    {
        var result = await fileCancellationRepository.CancelAsync(fileId, CurrentUserId, timeProvider.GetUtcNow(), cancellationToken);
        switch (result.Outcome)
        {
            case CancellationOutcome.FileNotFound:
                return FileNotFound();
            case CancellationOutcome.HasApprovedTransactions:
                return Conflict(new ErrorResponse { Message = HasApprovedTransactionsMessage(result.ApprovedCount) });
        }

        return await GetFileDetailsAsync(fileId, cancellationToken);
    }

    /// <summary>
    /// Both roles. Values the binder cannot read (unknown enum values, a file id that is not a UUID,
    /// an amount that is not a number) are refused with a 400 before this runs;
    /// <see cref="TransactionListQuery"/> checks the rest.
    /// </summary>
    public override async Task<ActionResult<TransactionPage>> ListTransactions(
        int? page = 1,
        int? pageSize = 20,
        TransactionSortColumn? sortBy = null,
        SortDirection? sortDirection = null,
        TransactionStatus? status = null,
        Guid? fileId = null,
        string? dateFrom = null,
        string? dateTo = null,
        decimal? minAmount = null,
        decimal? maxAmount = null,
        string? search = null,
        CancellationToken cancellationToken = default)
    {
        var query = TransactionListQuery.Create(
            page, pageSize, sortBy, sortDirection, status, fileId, dateFrom, dateTo, minAmount, maxAmount, search, ModelState);
        if (query is null)
        {
            return ValidationProblem(ModelState);
        }

        var transactions = await transactionRepository.ListAsync(query.Filter, query.Sort, query.Offset, query.PageSize, cancellationToken);
        return query.ToTransactionPage(transactions);
    }

    /// <summary>
    /// Approvers only (TL-05). Exports every transaction that matches the list's filters, in the
    /// list's order for the same sort, as a CSV attachment (EX-01..EX-04, EX-06). The filter and
    /// sort are read and checked exactly as for <see cref="ListTransactions"/>. When nothing
    /// matches there is nothing to export (409, EX-05). The export date in the file name, and each
    /// Last Changed On, are in the time zone of <see cref="AppSettings.ExportTimeZone"/>.
    /// </summary>
    [Authorize(Roles = nameof(UserRole.Approver))]
    public override async Task<IActionResult> ExportTransactions(
        TransactionSortColumn? sortBy = null,
        SortDirection? sortDirection = null,
        TransactionStatus? status = null,
        Guid? fileId = null,
        string? dateFrom = null,
        string? dateTo = null,
        decimal? minAmount = null,
        decimal? maxAmount = null,
        string? search = null,
        CancellationToken cancellationToken = default)
    {
        var filter = TransactionCriteria.CreateFilter(status, fileId, dateFrom, dateTo, minAmount, maxAmount, search, ModelState);
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var anyMatch = await transactionRepository.FindAnyMatchAsync(filter, cancellationToken);
        if (anyMatch is null)
        {
            return Conflict(new ErrorResponse { Message = filter.IsEmpty ? NoTransactionsToExportMessage : NoMatchesToExportMessage });
        }

        var timeZone = TimeZoneInfo.FindSystemTimeZoneById(settings.ExportTimeZone);
        var exportDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(timeProvider.GetUtcNow(), timeZone).DateTime);
        var rows = transactionRepository.ExportAsync(filter, TransactionCriteria.CreateSort(sortBy, sortDirection), cancellationToken);
        return new TransactionCsvResult(rows, ExportFileName.Create(filter, anyMatch.FileName, exportDate), timeZone);
    }

    /// <summary>Both roles (TL-06).</summary>
    public override async Task<ActionResult<TransactionDetails>> GetTransaction(Guid transactionId, CancellationToken cancellationToken = default)
    {
        var transaction = await transactionRepository.GetAsync(transactionId, cancellationToken);
        return transaction is null ? TransactionNotFound() : TransactionMapper.ToDetails(transaction);
    }

    /// <summary>Approvers only, for the Transactions menu badge (TL-07).</summary>
    [Authorize(Roles = nameof(UserRole.Approver))]
    public override async Task<ActionResult<ImportedTransactionCount>> GetImportedTransactionCount(CancellationToken cancellationToken = default) =>
        new ImportedTransactionCount { Count = await transactionRepository.CountImportedAsync(cancellationToken) };

    /// <summary>
    /// Approvers only. Approves an Imported transaction, recording who and when (AP-02, AP-03), and
    /// returns its details. One that is no longer Imported is not changed (409, AP-04).
    /// </summary>
    [Authorize(Roles = nameof(UserRole.Approver))]
    public override async Task<ActionResult<TransactionDetails>> ApproveTransaction(Guid transactionId, CancellationToken cancellationToken = default) =>
        ToReviewResponse(await transactionReviewRepository.ApproveAsync(transactionId, CurrentUserName, timeProvider.GetUtcNow(), cancellationToken));

    /// <summary>
    /// Approvers only. Rejects an Imported transaction with the trimmed reason, recording who and when
    /// (RJ-01..RJ-04), and returns its details. The reason is checked first (see
    /// <see cref="RejectionReason"/>); a transaction that is no longer Imported is not changed (409, RJ-05).
    /// </summary>
    [Authorize(Roles = nameof(UserRole.Approver))]
    public override async Task<ActionResult<TransactionDetails>> RejectTransaction(
        Guid transactionId, RejectTransactionRequest body, CancellationToken cancellationToken = default)
    {
        var reason = RejectionReason.Check(body.Reason, ModelState);
        if (reason is null)
        {
            return ValidationProblem(ModelState);
        }

        return ToReviewResponse(
            await transactionReviewRepository.RejectAsync(transactionId, reason, CurrentUserName, timeProvider.GetUtcNow(), cancellationToken));
    }

    private Guid CurrentUserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private string CurrentUserName => User.FindFirstValue(ClaimTypes.Name)!;

    /// <summary>The changed transaction's details, 404, or 409 naming its current status with its details.</summary>
    private ActionResult<TransactionDetails> ToReviewResponse(ReviewResult result) => result.Outcome switch
    {
        ReviewOutcome.Changed => TransactionMapper.ToDetails(result.Transaction!),
        ReviewOutcome.AlreadyReviewed => Conflict(new TransactionConflict
        {
            Message = AlreadyReviewedMessage(result.Transaction!.Status),
            Transaction = TransactionMapper.ToDetails(result.Transaction),
        }),
        _ => TransactionNotFound(),
    };

    /// <summary>The file's details with its processing history, or 404 when no file has the id.</summary>
    private async Task<ActionResult<FileDetails>> GetFileDetailsAsync(Guid fileId, CancellationToken cancellationToken)
    {
        var details = await LoadFileDetailsAsync(fileId, cancellationToken);
        return details is null ? FileNotFound() : details;
    }

    /// <summary>The file's details with its processing history, or null when no file has the id.</summary>
    private async Task<FileDetails?> LoadFileDetailsAsync(Guid fileId, CancellationToken cancellationToken)
    {
        var file = await fileDetailsRepository.GetDetailsAsync(fileId, cancellationToken);
        if (file is null)
        {
            return null;
        }

        var history = await fileDetailsRepository.GetProcessingHistoryAsync(fileId, cancellationToken);
        return FileDetailsMapper.ToFileDetails(file, history);
    }

    private NotFoundObjectResult FileNotFound() => NotFound(new ErrorResponse { Message = FileNotFoundMessage });

    private NotFoundObjectResult TransactionNotFound() => NotFound(new ErrorResponse { Message = TransactionNotFoundMessage });

    /// <summary>The response refusing a correction, or null when the correction was made.</summary>
    private ObjectResult? RefuseCorrection(CorrectionOutcome outcome) => outcome switch
    {
        CorrectionOutcome.FileNotFound => FileNotFound(),
        CorrectionOutcome.NotWaitingForCorrections => Conflict(new ErrorResponse { Message = NotWaitingForCorrectionsMessage }),
        CorrectionOutcome.NotAnInvalidRow => BadRequest(new ErrorResponse { Message = NotAnInvalidRowMessage }),
        CorrectionOutcome.RowRepeated => BadRequest(new ErrorResponse { Message = RowRepeatedMessage }),
        _ => null,
    };

    private static List<CorrectedRow> ToCorrectedRows(IEnumerable<RowCorrection> rows) => rows
        .Select(row => new CorrectedRow(
            row.Id, row.Reference, row.TransactionDate, row.AccountNumber, row.Description, row.Amount, row.TransactionType, row.Currency))
        .ToList();

    private static CurrentUser ToCurrentUser(string name, string email, string role) => new()
    {
        Name = name,
        Email = email,
        Role = Enum.Parse<UserRole>(role),
    };
}
