# Story 4: File details with summary, review progress and processing history

- **Epic:** file-dashboard-and-details
- **Slug:** story-4-file-details
- **Roles:** Importer, Approver
- **Route:** /dashboard/files/[fileId]
- **Page action:** create_new
- **Infrastructure only:** false
- **Requirement IDs:** R7, R9, R10, R11, R12, R16, R17, R18, BR2, BR5, BR6, BR11, NFR-2, NFR-3, NFR-5
- **Target file:** app-frontend/src/app/(authenticated)/dashboard/files/[fileId]/page.tsx

## Plain summary

Selecting a file on the Dashboard opens its details: name, status in words, total rows, how many rows were loaded, skipped because the reference already existed, or ignored because the reference was empty, and how many of its transactions are Imported, Approved and Rejected. Selecting one of those transaction counts opens the Transactions list filtered to that file and status. When nothing is still Imported the screen says the file is fully reviewed. A processing history lists each stage with when it started and finished, and "Back to dashboard" returns to the list exactly as it was.

## Technical summary

- **New route.** `(authenticated)/dashboard/files/[fileId]/page.tsx`, wrapped in `RouteGuard route="/dashboard"` (no new access-map row). Client view `components/files/FileDetailsView.tsx` loads `getFile(fileId)`.
- **Header.** File name, `FileStatusBadge` (words), uploaded by / uploaded at, last processed (or "Not processed yet"). Reserve an actions area in the header (empty now; Cancel and Correct arrive in file-correction-and-cancel).
- **Row summary.** Total rows (`rowCount`), Loaded (`loadedCount`), Skipped – reference already existed (`skippedExistingCount`), Ignored – empty reference (`ignoredEmptyReferenceCount`), shown exactly as returned (BR5). While null (not loaded yet) show "Not counted yet".
- **Transaction counts.** Imported / Approved / Rejected from `transactions`. When `areTransactionsAvailable` is true each is a link to `/transactions?fileId=<id>&status=<Status>` (built with `lib/transactions/listQuery.ts`). (Story 5 handles the not-available case.)
- **Fully reviewed.** A "This file is fully reviewed" message only when `isFullyReviewed` is true (BR6); never recomputed.
- **Processing history.** An ordered list / table of `processingHistory`: stage in words (Receive -> "Received", DuplicateCheck -> "Duplicate check", ReadRows -> "Read rows", ConvertTypes -> "Convert values", CheckRows -> "Check rows", WaitForCorrections -> "Waiting for corrections", Load -> "Load", Cancelled -> "Cancelled"), Started, Finished ("In progress" when `finishedAt` is null). Times in local `yyyy-MM-dd HH:mm:ss` (new `formatLocalDateTimeWithSeconds`, or a seconds option on `formatLocalDateTime`).
- **Back link.** "Back to dashboard" to the remembered list view: the file list remembers its search on row click (new `lib/files/listReturn.ts`, mirroring `lib/transactions/listReturn.ts`).
- **States.** Loading; problem with Retry; 404 -> "File not found" with the back link.
- **Layout.** Summary, history and (story 5) download stack in one column below md.

## Acceptance criteria

- **AC-1** (coverage: playwright): Selecting a file on the Dashboard (by mouse or keyboard) opens its details showing its name, status in words, total rows, and the loaded, skipped (reference already existed) and ignored (empty reference) counts.
- **AC-2** (coverage: playwright): Selecting the file's Imported, Approved or Rejected count opens the Transactions list filtered to that file and that status.
- **AC-3** (coverage: vitest): A file with none of its transactions still Imported says it is fully reviewed; a file with Imported transactions does not.
- **AC-4** (coverage: vitest): The processing history lists each stage the file went through, in order, with the time it started and finished, and an unfinished stage shows as in progress.
- **AC-5** (coverage: vitest): The details screen shows a loading state, a problem with Retry when loading fails, and "File not found" for an unknown file.
- **AC-6** (coverage: playwright): "Back to dashboard" returns to the file list with the same filters, sort, page and page size.

Additional technical checks (1):
- Loaded, skipped and ignored are displayed exactly as returned (never recomputed), and the fully-reviewed message follows `isFullyReviewed` only (BR5, BR6).

## Manual test checklist

- On the Dashboard click the seeded example file → you see its details: Completed, 20 rows, 20 loaded, 0 skipped, 0 ignored, 20 Imported, 0 Approved, 0 Rejected.
- Click the Imported count → you land on Transactions showing only that file's Imported transactions.
- Check the processing history → each stage is listed in order with a start and finish time.
- As the Approver, approve or reject all of a file's transactions, then open the file → it says the file is fully reviewed.
- Filter and sort the Dashboard, open a file, then click "Back to dashboard" → the list is exactly as you left it.
- At phone width → the summary and history are stacked one under the other with no sideways scrolling.

## Resolved design choices (defaults chosen; stories approval delegated)

- File details live at `/dashboard/files/<id>`, so the Dashboard stays highlighted in the menu and no new access rule is needed.
- Processing stages are shown in plain words (e.g. "Duplicate check", "Waiting for corrections") with times to the second, because stages often run within the same minute.
- The row counts are labelled "Loaded", "Skipped – reference already existed" and "Ignored – empty reference".
- An actions area is reserved in the details header for the importer's Cancel and Correct actions; it is empty in this epic for both roles.

## Infrastructure reuse notes

- **API calls.** `getFile` from `app-frontend/src/lib/api/endpoints.ts` with `FileDetails` / `ProcessingStageEntry` from `src/types/api-generated.ts`; proxy already allows GET /files/{id}.
- **Pattern.** Follow `components/transactions/TransactionDetailsView.tsx` (dt/dd layout, loading / Retry / 404 states, back link to the remembered list view) and `lib/transactions/listReturn.ts`.
- **Links into transactions.** Build `/transactions?fileId=&status=` with `toListSearch` from `lib/transactions/listQuery.ts`; the transactions list already supports both params and shows the file by name in its chips.
- **Shared pieces from story 1.** `FileStatusBadge`, file wording in `lib/format/file.ts`, `formatLocalDateTime`.
- **Errors.** `isRedirectingToSignIn` early return; `statusOf(error) === 404` for not found; `isNetworkError` for unreachable.
- **E2E mock.** Add GET /files/{id} to `app-frontend/e2e/fixtures/mock-backend.ts` (FileDetails for each seeded file, including a Completed file with Imported transactions, a fully reviewed file, and a file with skipped and ignored rows; 404 `{message:"File not found"}` for unknown ids).
