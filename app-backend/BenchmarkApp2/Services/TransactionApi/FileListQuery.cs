using BenchmarkApp2.Data;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>
/// The query of the file list (DB-02..DB-06): checks the values the binder could not refuse by
/// itself, applies the defaults, and turns repository rows into API items. Sort columns, sort
/// directions, statuses and visibilities arrive as enums, so only known values ever get this far.
/// </summary>
public sealed record FileListQuery(
    int Page,
    int PageSize,
    FileSortColumn SortBy,
    SortDirection SortDirection,
    FileStatus? Status,
    string? FileName,
    DateTimeOffset? ProcessedFrom,
    DateTimeOffset? ProcessedTo,
    FileVisibility Visibility)
{
    /// <summary>
    /// Applies the defaults and adds an error to <paramref name="errors"/> for each invalid value.
    /// Returns null when any value is invalid.
    /// </summary>
    public static FileListQuery? Create(
        int? page,
        int? pageSize,
        FileSortColumn? sortBy,
        SortDirection? sortDirection,
        FileStatus? status,
        string? fileName,
        DateTimeOffset? processedFrom,
        DateTimeOffset? processedTo,
        FileVisibility? visibility,
        ModelStateDictionary errors)
    {
        var sortColumn = sortBy ?? FileSortColumn.LastProcessedAt;
        var query = new FileListQuery(
            Page: page ?? Paging.DefaultPage,
            PageSize: pageSize ?? Paging.DefaultPageSize,
            SortBy: sortColumn,
            SortDirection: sortDirection ?? DefaultDirection(sortColumn),
            Status: status,
            FileName: fileName,
            ProcessedFrom: processedFrom,
            ProcessedTo: processedTo,
            Visibility: visibility ?? FileVisibility.Active);

        Paging.Validate(query.Page, query.PageSize, errors);
        if (processedFrom > processedTo)
        {
            errors.AddModelError("processedTo", "The end of the process-date range must not be before its start.");
        }
        return errors.IsValid ? query : null;
    }

    public FileListCriteria ToCriteria() => new(
        Status: Status?.ToString(),
        FileNameContains: FileName,
        ProcessedFrom: ProcessedFrom,
        ProcessedTo: ProcessedTo,
        Visibility: Visibility switch
        {
            FileVisibility.Active => FileListVisibility.Active,
            FileVisibility.Cancelled => FileListVisibility.Cancelled,
            _ => FileListVisibility.Both,
        },
        SortBy: SortBy switch
        {
            FileSortColumn.FileName => FileListSortColumn.FileName,
            FileSortColumn.RowCount => FileListSortColumn.RowCount,
            FileSortColumn.Status => FileListSortColumn.Status,
            FileSortColumn.ImportedCount => FileListSortColumn.ImportedCount,
            _ => FileListSortColumn.LastProcessedAt,
        },
        Descending: SortDirection == SortDirection.Desc,
        Offset: Paging.Offset(Page, PageSize),
        Limit: PageSize);

    public FilePage ToFilePage(FileListPage page) => new()
    {
        Items = page.Rows.Select(ToItem).ToList(),
        Page = Page,
        PageSize = PageSize,
        TotalCount = page.TotalCount,
        TotalPages = Paging.TotalPages(page.TotalCount, PageSize),
    };

    /// <summary>The most recent processing comes first by default; every other column starts ascending.</summary>
    private static SortDirection DefaultDirection(FileSortColumn column) =>
        column == FileSortColumn.LastProcessedAt ? SortDirection.Desc : SortDirection.Asc;

    private static FileListItem ToItem(FileListRow row) => new()
    {
        Id = row.Id,
        FileName = row.FileName,
        Status = Enum.Parse<FileStatus>(row.Status),
        FailureKind = row.FailureKind is null ? null : Enum.Parse<FailureKind>(row.FailureKind),
        FailureReason = row.FailureReason,
        LastProcessedAt = row.LastProcessedAt is { } processedAt
            ? new DateTimeOffset(DateTime.SpecifyKind(processedAt, DateTimeKind.Utc))
            : null,
        RowCount = row.RowCount,
        ImportedCount = row.ImportedCount,
        IsCancelled = row.IsCancelled,
    };
}
