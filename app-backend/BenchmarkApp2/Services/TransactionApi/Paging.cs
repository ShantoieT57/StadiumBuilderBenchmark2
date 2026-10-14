using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace BenchmarkApp2.Services.TransactionApi;

/// <summary>The paging rules shared by every paged list (DB-04, TL-03).</summary>
public static class Paging
{
    public const int DefaultPage = 1;
    public const int DefaultPageSize = 20;
    public static readonly IReadOnlySet<int> PageSizes = new HashSet<int> { 5, 10, 20, 50 };

    /// <summary>Adds an error to <paramref name="errors"/> for a page below 1 or a page size that is not offered.</summary>
    public static void Validate(int page, int pageSize, ModelStateDictionary errors)
    {
        if (page < 1)
        {
            errors.AddModelError("page", "The page must be 1 or more.");
        }
        if (!PageSizes.Contains(pageSize))
        {
            errors.AddModelError("pageSize", "The page size must be 5, 10, 20 or 50.");
        }
    }

    /// <summary>The number of rows skipped before a page.</summary>
    public static long Offset(int page, int pageSize) => (page - 1L) * pageSize;

    /// <summary>The number of pages; 0 when nothing matches.</summary>
    public static int TotalPages(int totalCount, int pageSize) => (totalCount + pageSize - 1) / pageSize;
}
