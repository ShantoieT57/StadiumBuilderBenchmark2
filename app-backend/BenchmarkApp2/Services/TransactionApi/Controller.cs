using System.Security.Claims;
using BenchmarkApp2.Data;
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
    FileDetailsRepository fileDetailsRepository) : ControllerBase
{
    private const string CsvContentType = "text/csv";
    private const string FileNotFoundMessage = "File not found";
    private const string FileContentDiscardedMessage = "The original file is no longer available because the file has been cancelled.";
    private const string NotWaitingForCorrectionsMessage = "This file is not waiting for corrections.";
    private const string InvalidCredentialsMessage = "Invalid email or password";
    private const string InvalidFileNameMessage = "Invalid file name";
    private const string NotCsvFileMessage = "Only .csv files can be uploaded. Please choose a .csv file.";

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
            Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!),
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
    public override async Task<ActionResult<FileDetails>> GetFile(Guid fileId, CancellationToken cancellationToken = default)
    {
        var file = await fileDetailsRepository.GetDetailsAsync(fileId, cancellationToken);
        if (file is null)
        {
            return FileNotFound();
        }

        var history = await fileDetailsRepository.GetProcessingHistoryAsync(fileId, cancellationToken);
        return FileDetailsMapper.ToFileDetails(file, history);
    }

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
        if (!FileDetailsMapper.IsWaitingForCorrections(file))
        {
            return Conflict(new ErrorResponse { Message = NotWaitingForCorrectionsMessage });
        }

        var rows = await fileDetailsRepository.GetInvalidRowsAsync(fileId, cancellationToken);
        return FileDetailsMapper.ToInvalidRowList(rows);
    }

    private NotFoundObjectResult FileNotFound() => NotFound(new ErrorResponse { Message = FileNotFoundMessage });

    private static CurrentUser ToCurrentUser(string name, string email, string role) => new()
    {
        Name = name,
        Email = email,
        Role = Enum.Parse<UserRole>(role),
    };
}
