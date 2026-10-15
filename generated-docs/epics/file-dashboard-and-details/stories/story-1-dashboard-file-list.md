# Story 1: Dashboard file list with sorting, paging and phone layout

- **Epic:** file-dashboard-and-details
- **Slug:** story-1-dashboard-file-list
- **Roles:** Importer, Approver
- **Route:** /dashboard
- **Page action:** modify_existing
- **Infrastructure only:** false
- **Requirement IDs:** R2, R3, R4, R8, R16, BR3, BR10, BR11, NFR-1, NFR-2, NFR-3, NFR-5, NFR-6, NFR-7
- **Target file:** app-frontend/src/app/(authenticated)/dashboard/page.tsx

## Plain summary

Importers and Approvers open the Dashboard and see every file with its name, when it was last processed, its number of rows, its status in words, and how many of its transactions are still Imported. The most recently processed file comes first, 20 per page; they can sort by any column, move between pages, choose 5, 10, 20 or 50 per page, and use the list on a phone. When there are no files it says "No files yet", and an Importer also gets a link to upload one. The list updates by itself as files change.

## Technical summary

- **Page.** Replace the placeholder `(authenticated)/dashboard/page.tsx`. Keep it wrapped in `RouteGuard route="/dashboard"` and render no `<main>`. It becomes a client file list (e.g. `components/files/FilesList.tsx`) that calls `getFiles`.
- **URL state.** Mirror `lib/transactions/listQuery.ts` + `useListQuery` in a new `lib/files/listQuery.ts` (+ `useFileListQuery`): `sortBy`, `sortDirection`, `page`, `pageSize` in the URL with the API's names and values; defaults (LastProcessedAt Desc, page 1, size 20) omitted. Sorting toggles the current column, else that column's default direction (LastProcessedAt Desc, others Asc). Page size change resets to page 1. Parse (and keep) `status`, `fileName`, `processedFrom`, `processedTo`, `visibility` in the same module now so stories 2 and 3 only add UI.
- **Columns.** File name (a link to the file's details at `/dashboard/files/<id>`; the page arrives in story 4), Last processed, Rows, Status, Imported.
  - `lastProcessedAt` null -> "Not processed yet"; otherwise `formatLocalDateTime` (browser local time, `yyyy-MM-dd HH:mm`).
  - `rowCount` null -> "Not counted yet".
  - Status in words on a new `FileStatusBadge` (Uploaded / Processing / Completed / Failed; tokens only, never colour alone). A cancelled file also shows a "Cancelled" badge in words.
- **Layout.** Table at md+; below md, compact `<li>` rows showing name, status, Imported count and last processed, with a row-actions area (details link first). Leave room for a per-row action slot (the importer correction shortcut arrives in file-correction-and-cancel); render nothing in it now.
- **Paging.** Previous / Next, "Rows per page" select (5/10/20/50), page X of Y; a page past the end offers "Go to last page" (as the transactions list does).
- **States.** Loading; problem with Retry (unreachable wording via `isNetworkError`; return early on `isRedirectingToSignIn`); "No files yet" when the unfiltered list is empty (`totalCount` 0 with no filters and default visibility). Importer additionally sees a link to `/upload` (placeholder route from the shell); Approver sees no upload link. Previous rows stay under `aria-busy` with an "Updating…" status while a changed view loads.
- **Live refresh.** `useEvents().subscribe('file-changed' | 'transactions-changed' | 'resync')` -> refetch in place with the current params. No second EventSource.
- **Privacy.** File names and counts only; nothing logged beyond that.

## Acceptance criteria

- **AC-1** (coverage: vitest): Each file shows its name, last processed date and time ("Not processed yet" when it has not been processed), number of rows, status in words, and how many of its transactions are still Imported; a cancelled file is also marked "Cancelled" in words.
- **AC-2** (coverage: playwright): The list opens with the most recently processed file first. Choosing a column header sorts by that column (one at a time, direction toggles), the sort stays while paging, and reload and the browser Back button restore the same sort and page.
- **AC-3** (coverage: playwright): The list shows 20 files per page by default; choosing 5, 10, 20 or 50 changes the page size and returns to page 1, and Previous / Next move between pages.
- **AC-4** (coverage: vitest): While loading the list shows a loading state; a failed load shows a problem with a Retry action; with no files at all it says "No files yet", with a link to Upload for an Importer and no upload link for an Approver.
- **AC-5** (coverage: playwright): At 360px wide each file shows its name, status, Imported count and last processed, its details link stays reachable by keyboard, and the page has no horizontal scroll.
- **AC-6** (coverage: vitest): When a file-changed, transactions-changed or resync update arrives, the list refreshes in place and keeps its sort, page and page size.

Additional technical checks (2):
- The list request uses the API's parameter names and omits defaults; one shared live connection only, no new EventSource (NFR-1, NFR-7).
- Nothing beyond file names and counts is written to client logs (NFR-6).

## Manual test checklist

- Sign in as the Approver and open Dashboard from the menu → you see the files, the most recently processed at the top, with name, last processed, rows, status in words and Imported count.
- The seeded example file → shows Completed, 20 rows and 20 Imported.
- Click the "File name" column heading, then reload the page → the list is still sorted by name.
- Change "Rows per page" to 5 → you see at most 5 files and you are back on page 1.
- Narrow the browser to phone width (about 360px) → each file shows as a compact row with name, status, Imported count and last processed, and there is no sideways scrolling.
- Sign in as the Importer and open Dashboard → you see the same list.

## Resolved design choices (defaults chosen; stories approval delegated)

- The list's sort, page, page size (and, from story 2, filters) live in the address bar, so reload, Back and shared links keep the view, exactly like the transactions list.
- A file that has not been processed yet shows "Not processed yet" in Last processed; a file not read yet shows "Not counted yet" for Rows.
- File status badge colours: Completed uses the success token, Failed the destructive token, Processing the warning token, Uploaded a neutral outline; the word is always shown. Cancelled files carry an extra "Cancelled" word badge.
- The file name is the link to the file's details (`/dashboard/files/<id>`), so the Dashboard stays highlighted in the menu while viewing a file.
- The "No files yet" state is only shown when there are no files at all (no filters, default Active view); a filtered empty result is the no-match state (story 2).

## Infrastructure reuse notes

- **API calls.** Use `getFiles` from `app-frontend/src/lib/api/endpoints.ts` with `ListFilesQuery` / `FilePage` / `FileListItem` from `src/types/api-generated.ts`. Don't add new wrappers.
- **Proxy.** `BACKEND_ENDPOINTS` already allows GET /files, GET /files/{id}, GET /files/{id}/content and GET /dashboard/summary. No allowlist change.
- **Access.** Keep `RouteGuard route="/dashboard"`; `ROUTE_ACCESS` already grants both roles. Use `useCurrentUser`-style role info from the shell (or pass the role from the server page via `requireSession()`) to decide the Upload link; never show it to an Approver.
- **URL-state pattern.** Mirror `lib/transactions/listQuery.ts` (`parseListState` / `toListSearch` / `withSort` / `withPage` / `withPageSize`) and `components/transactions/useListQuery.ts`. Don't generalise the transactions module in this story.
- **List shell.** Follow `TransactionsList.tsx` for the table / compact rows split, paging controls, "Updating…" state and past-the-end handling. Reuse shadcn Table, Select (with the type-ahead fix), Badge, Button, Tooltip.
- **Formatting.** `formatLocalDateTime` from `lib/format/transaction.ts` for `lastProcessedAt` (offset ISO -> local). Add file wording (status words) in a small `lib/format/file.ts` rather than inside the component.
- **Status styling.** `success` / `warning` / `destructive` tokens only, as `TransactionStatusBadge` does. No palette utilities or hex values.
- **Live refresh.** `useEvents().subscribe(...)` from `src/contexts/EventsContext.tsx`.
- **Errors.** Return early on `isRedirectingToSignIn(error)`; `isNetworkError` for the unreachable wording; no per-screen 401 handling.
- **E2E mock.** Extend `app-frontend/e2e/fixtures/mock-backend.ts` (`listFiles`, today "paging honoured, filters and sort not modelled") to honour `sortBy` / `sortDirection` / `pageSize` and default `visibility=Active`, with enough seeded files (`src/mocks/data/files.ts`) for more than one page and at least one cancelled and one unprocessed file. Keep the transactions-list specs green (they use GET /files for the file picker).
