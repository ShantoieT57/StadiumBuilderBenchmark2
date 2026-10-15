# Epic Brief: File dashboard and file details

Inherits roles, auth, data source, compliance, and styling from project.md.

Depends on: sign-in-and-app-shell, transactions-list.

## Goal

Both roles see every file with its status and review progress, can sort and filter the list, and can open a file to see its summary, processing history, why it failed, and download the original.

Screens delivered: the Dashboard (file list with status and transaction counts) and the File details screen. Both roles use both screens. Importer-only actions (the correction shortcut DB-08, the cancel action FD-08, and the correction screen from FD-06) arrive in the later epic file-correction-and-cancel, so leave room for them in the layout without building them.

## Data Model

Scoped to this epic. All shapes come from `app-backend/docs/TransactionApi.yaml`, which is authoritative. Confirm exact field names there when building.

- **File (list row)** from `GET /files`: name, last processed date and time, row count, status (`Uploaded` | `Processing` | `Completed` | `Failed`), count of transactions still Imported, and whether the file is cancelled.
- **Dashboard summary** from `GET /dashboard/summary`: number of files per status, and Imported, Approved and Rejected transaction counts across all files that are not cancelled.
- **File details** from `GET /files/{fileId}`: the file's name, status, total rows, loaded / skipped (reference already existed) / ignored (empty reference) counts, Imported / Approved / Rejected transaction counts, failure reason, `processingHistory` (stage, started, finished), and the flags `isFullyReviewed`, `areTransactionsAvailable`, `canDownload`.
- **Original file** from `GET /files/{fileId}/content` (CSV; 410 once cancelled).
- Query parameters for the list: `page`, `pageSize` (5/10/20/50), `sortBy` (`FileName` | `LastProcessedAt` | `RowCount` | `Status` | `ImportedCount`), `sortDirection`, `status`, `fileName`, `processedFrom`, `processedTo`, `visibility` (`Active` | `Cancelled` | `Both`).
- Live updates from `GET /events` (shared connection owned by the app shell): `file-changed`, `transactions-changed`, `resync`.

## Functional Requirements

Source rule IDs are given in brackets. The text is the brief's rule, quoted exactly.

- **R1** [DB-01]: Above the list, the dashboard shows how many files are in each status, and how many transactions are **Imported**, **Approved**, and **Rejected** across all files that are not cancelled. Selecting a file count filters the list to that status. Selecting a transaction count opens the transactions list filtered to that status.
- **R2** [DB-02]: Each file shows its name, the date and time it was last processed, its number of rows, its status, and how many of its transactions are still **Imported**.
- **R3** [DB-03]: The file processed most recently appears first. The person can sort by any column, one at a time.
- **R4** [DB-04]: The list shows 20 files per page by default. The person can choose 5, 10, 20, or 50.
- **R5** [DB-05]: The person can filter by status, by file name, and by a range of process dates.
- **R6** [DB-06]: Cancelled files are hidden by default. The person can choose to see active files, cancelled files, or both.
- **R7** [DB-07]: Selecting a file opens its detail screen.
- **R8** [DB-09]: When there are no files, the dashboard says "No files yet". An importer also sees a link to upload one.
- **R9** [FD-01]: The summary shows the file's total rows, how they were handled (FP-07), and how many of its transactions are **Imported**, **Approved**, and **Rejected**.
- **R10** [FD-02]: Selecting any of those counts opens the transactions list filtered to that file and that status.
- **R11** [FD-03]: When none of the file's transactions is still **Imported**, the summary says the file is fully reviewed.
- **R12** [FD-04]: The processing history lists each stage the file has been through, with the time it started and finished.
- **R13** [FD-05]: Any signed-in person can download the original file exactly as it was uploaded.
- **R14** [FD-06]: A **Failed** file shows the reason it failed. For invalid rows, the importer also sees the correction screen (FC-01).
- **R15** [FD-07]: A file still **Uploaded** or **Processing** says that its transactions are not available yet.
- **R16** [FS-03]: The status is always shown as words, never as a colour alone.
- **R17** [FP-05]: Transaction references are unique across the whole app, ignoring upper and lower case. When a row's reference already exists, the app skips that row and does not change the existing transaction.
- **R18** [FP-07]: The file's summary shows how many rows were loaded, how many were skipped because their reference already existed, and how many were ignored because their reference was empty. The three always add up to the file's row count.

Scope notes for R14: this epic shows the failure reason for every Failed file (a duplicate names the earlier file per FP-02; invalid rows say the file is waiting for corrections). The importer's correction screen itself belongs to file-correction-and-cancel. R17 and R18 surface here only as the file summary's loaded / skipped / ignored counts; the skip behaviour itself is done by the back-end.

## Business Rules

- **BR1:** Transaction counts on the dashboard (R1) cover files that are not cancelled only (DB-01).
- **BR2:** The dashboard's file-status counts and transaction counts link into the transactions list (built in transactions-list), pre-filtered by status (R1) and by file and status (R10).
- **BR3:** The sort is by one column at a time, with last-processed descending as the default (R3).
- **BR4:** Filters on the file list combine; a file must match every active filter to appear. Selecting a file-status count sets the status filter.
- **BR5:** Loaded + skipped + ignored always equals the file's row count (R18). Show the three numbers as the back-end returns them.
- **BR6:** The "fully reviewed" message (R11) shows only when the file's transactions are available and none is Imported. Use `isFullyReviewed` from the back-end.
- **BR7:** Download is offered only when `canDownload` is true. A cancelled file has no copy (410), so it is not offered.
- **BR8:** A file that is Uploaded or Processing shows the "transactions are not available yet" message (R15) and does not offer links to the transactions list. Use `areTransactionsAvailable`.
- **BR9:** A file that failed as a duplicate stays failed and cannot be retried (FS-01). Show only the reason; no retry is offered.
- **BR10:** The importer's upload link in the empty state (R8) points to the Upload screen. A placeholder route for it exists from the shell until file-upload is built.
- **BR11:** Approvers never see importer-only items, and importers never see approver-only items (AC-01). Nothing importer-only is shown on this epic's screens yet.

## Key Workflows

1. **Review the dashboard.** Open Dashboard. See the status counts and transaction counts, then the file list, newest processed first, 20 per page.
2. **Narrow the list.** Select a status count, or use the status, file name, and process-date filters. Choose active, cancelled, or both. Sort by any column. Change the page size.
3. **Jump to transactions.** Select the Imported, Approved, or Rejected count above the list and land on the transactions list filtered to that status.
4. **Open a file.** Select a file to see its details: summary counts, processing history, and the reason if it failed.
5. **Check review progress.** On the details screen, select a transaction count to open the transactions list filtered to that file and status. When nothing is still Imported, the screen says the file is fully reviewed.
6. **Download the original.** On the details screen, download the file exactly as uploaded.
7. **Watch a file progress.** With a file Uploaded or Processing open on the dashboard or details screen, see it update on its own as it moves through the stages, without a refresh.
8. **Start from nothing.** With no files, see "No files yet". An importer also sees a link to the Upload screen.

## Feature NFRs

- **NFR-1 (live updates):** The dashboard list, its counts, and the file details update without a page refresh. Subscribe to `file-changed` and `transactions-changed` from the shell's single `/events` connection. On `resync`, refetch the summary, the list, and the open file's details. Do not open a second event connection.
- **NFR-2 (GN-01, phone layout):** On a narrow screen the file list shows each file's key details (name, status, Imported count, last processed) and keeps its actions available. The details screen stacks its summary, history, and download. The dashboard's status and transaction counts stay reachable.
- **NFR-3 (GN-02, GN-03):** Counts, rows, sort headers, filters, and the download action work by keyboard alone. Any icon-only button has a tooltip label on hover and on keyboard focus.
- **NFR-4 (GN-04, GN-05):** Filter inputs follow the shell's form conventions (checked on leave and on submit, not on every keystroke). Problems stay on screen until resolved. Success messages disappear on their own after a few seconds.
- **NFR-5:** Loading, empty, and error states with a retry affordance for every fetch (NFR-base-5). A failed download shows the actual error, and a 410 explains that the original was discarded when the file was cancelled.
- **NFR-6 (privacy):** File names and counts may appear in the UI. Do not write account numbers or descriptions to client logs. The downloaded original contains account numbers, so it is delivered through the browser as a download and never previewed in the page.
- **NFR-7:** All requests go through the app's API client and same-origin proxy, never to `:5100` directly.

## Out of Scope

- The importer-only correction shortcut on the list (DB-08), the correction screen (FC-01, FC-02, FC-03), and the cancel action with its confirmation (FD-08, FX-01..FX-06). These are built in file-correction-and-cancel. Leave room for a per-row action slot on the list and an actions area on the details screen.
- The upload screen and the upload flow (file-upload). Only a link to it is in scope.
- The transactions list, its filters, and approve / reject / export. This epic links into it.
- Sign-in, the menu, and the `/events` connection itself (sign-in-and-app-shell).

## Notes & Caveats

- The back-end already provides sort, filter, paging, and the `isFullyReviewed`, `areTransactionsAvailable`, and `canDownload` flags. Use them instead of recomputing in the browser.
- File status must never rely on colour alone (R16). Use a text label, and colour only as an addition. Colours come from tokens in `globals.css`.
- No design source exists for this project (styling is template defaults), so layout is decided during BUILD within the Shadcn UI and Tailwind conventions.
- The seeded example file (20 rows, all valid) is expected to show Completed with 20 loaded, 0 skipped, 0 ignored, and 20 Imported.
- Cancelled files appear only when the person chooses cancelled or both (R6). Their details and counts must handle the discarded original (410).
