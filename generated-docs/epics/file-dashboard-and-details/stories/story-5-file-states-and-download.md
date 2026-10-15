# Story 5: Failed, in-progress and cancelled files, live updates and downloading the original

- **Epic:** file-dashboard-and-details
- **Slug:** story-5-file-states-and-download
- **Roles:** Importer, Approver
- **Route:** /dashboard/files/[fileId]
- **Page action:** modify_existing
- **Infrastructure only:** false
- **Requirement IDs:** R13, R14, R15, BR7, BR8, BR9, NFR-1, NFR-3, NFR-5, NFR-6, NFR-7
- **Target file:** app-frontend/src/app/(authenticated)/dashboard/files/[fileId]/page.tsx

## Plain summary

On the file details screen, anyone signed in can download the original file exactly as it was uploaded. A Failed file shows why it failed (a duplicate names the earlier file; invalid rows say the file is waiting for corrections) with no retry. A file still Uploaded or Processing says its transactions are not available yet and offers no links to them, and the screen updates by itself as the file moves through its stages. A cancelled file says so and does not offer the download.

## Technical summary

- **Download.** A "Download original" button, shown only when `canDownload` is true (BR7). Add a download function in the API layer (e.g. `downloadFileContent(fileId)` in `lib/api/endpoints.ts`, calling `get<Blob>` with the client's binary-response option on `/files/{id}/content`) so the request goes through the API client and same-origin proxy (central 401 handling, `APIError` mapping). The browser saves the Blob through a temporary object URL + `<a download>` named with the file's `fileName`, then revokes the URL. The content is never read, parsed, previewed or logged (NFR-6).
  - Success: a self-closing "Download started" success message via `useToast()`.
  - Failure: a persistent problem via `useToast()` with the actual error message; 410 -> "The original file is no longer available because the file was cancelled."; unreachable -> the shared unreachable wording. Return early on `isRedirectingToSignIn`.
- **Failed.** When `status` is Failed, a problem panel "Why it failed" showing `failureReason` verbatim (a duplicate names the earlier file; invalid rows say the file is waiting for corrections). No retry action (BR9). The importer's correction screen is out of scope; leave the header actions area empty.
- **Not available yet.** When `areTransactionsAvailable` is false: "This file's transactions are not available yet" in place of the transaction-count links (counts not linked) (BR8).
- **Cancelled.** When `isCancelled`: a "Cancelled" badge in words, "Cancelled on <date> by <name>" (name omitted when null), and a note that the original was discarded instead of the download button.
- **Live updates.** `useEvents().subscribe('file-changed')` -> refetch when `fileId` matches the open file; `transactions-changed` and `resync` -> refetch. Refetch in place (no loading flash).

## Acceptance criteria

- **AC-1** (coverage: playwright): Selecting "Download original" downloads the file under its original name, without showing its contents in the page.
- **AC-2** (coverage: vitest): A failed download shows the actual problem, and a 410 explains that the original was discarded when the file was cancelled; the problem stays until dismissed.
- **AC-3** (coverage: vitest): A cancelled file is shown as cancelled with when and by whom, and no download is offered.
- **AC-4** (coverage: vitest): A Failed file shows the reason it failed and offers no retry.
- **AC-5** (coverage: vitest): A file still Uploaded or Processing says its transactions are not available yet and its transaction counts are not links.
- **AC-6** (coverage: vitest): When a file-changed update for the open file, or a resync, arrives, the details refresh in place (e.g. Processing becomes Completed and the counts become links) without a page refresh.

Additional technical checks (2):
- The download goes through the API client and same-origin proxy, never directly to the back-end, and the file content is never logged (NFR-6, NFR-7).
- Updates for other files do not refetch the open file's details.

## Manual test checklist

- Open the seeded example file and click "Download original" → the browser saves the CSV with its original name; open it → it matches the file that was uploaded.
- Open a Failed file → you see why it failed and there is no retry button.
- Open a file that is Uploaded or Processing → it says its transactions are not available yet and the counts are not links.
- With a file being processed open on the details screen → its status and counts update on their own as it finishes, without reloading.
- Show "Both" on the Dashboard and open a cancelled file → it says it was cancelled, by whom and when, and there is no download button.
- Using only the keyboard, Tab to "Download original" and press Enter → the file downloads.

## Resolved design choices (defaults chosen; stories approval delegated)

- The download is a labelled button ("Download original"), not an icon-only button.
- The saved file is named with the file's name from its details (the back-end sends the same original name in the download response).
- Download success is a short self-closing message; a download problem stays until dismissed.
- The failure reason is shown exactly as the back-end words it, in a problem panel near the top of the details.
- While transactions are not available yet, the Imported / Approved / Rejected counts are still shown (as zero) but not as links, with the "not available yet" message beside them.

## Infrastructure reuse notes

- **API client.** `apiClient` / `get` in `app-frontend/src/lib/api/client.ts` already supports a binary-response option returning a Blob (`handleSuccessResponse(..., isBinaryResponse)`); add the single endpoint function for `/files/{id}/content` beside the generated ones. Never call `fetch()` in a component. Proxy already allows GET /files/{id}/content and streams the body.
- **Errors.** `statusOf(error) === 410` for the discarded original, `isNetworkError` for unreachable, `isRedirectingToSignIn` early return.
- **Toasts.** `useToast().showToast({ variant: 'success' | 'error', ... })` from `src/contexts/ToastContext.tsx`.
- **Live refresh.** `useEvents().subscribe('file-changed', ({ fileId }) => ...)` from `src/contexts/EventsContext.tsx` (`FileChangedEvent` carries `fileId`, `status`, `isCancelled`).
- **E2E mock.** Add GET /files/{id}/content to `app-frontend/e2e/fixtures/mock-backend.ts` (`text/csv`, `Content-Disposition: attachment; filename=...; filename*=UTF-8''...`; 410 `{message}` for a cancelled file), plus FileDetails fixtures for a Failed duplicate, a Failed invalid-rows file, a Processing file and a cancelled file.
