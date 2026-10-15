# Story 1: Upload a file with progress and confirmation

- **Epic:** file-upload
- **Slug:** story-1-upload-a-file
- **Roles:** Importer
- **Route:** /upload
- **Page action:** modify_existing
- **Infrastructure only:** false
- **Requirement IDs:** R1, R2, R5, R7, R8, R9, BR1, BR5, BR6, BR7, BR8, NFR-1, NFR-2, NFR-3, NFR-4
- **Target file:** app-frontend/src/app/(authenticated)/upload/page.tsx

## Plain summary

The Importer lands on the Upload screen, drags the daily transaction file onto it or chooses it from their computer, sees that the kind of file is already set to Bank transactions, and selects Upload. A progress bar shows while the file uploads, then "<file name> has been uploaded successfully." appears and a link opens the file's details, where the Importer watches it move from Uploaded to Processing to Completed (or Failed, for example as a duplicate) without refreshing.

## Technical summary

- **Page.** Replace the placeholder `(authenticated)/upload/page.tsx`. Keep `RouteGuard route="/upload"` (Importer only; Approvers get `NoAccess`) and render no `<main>`. Client form in `components/upload/UploadForm.tsx`.
- **File field.** A drop area (drag over highlights it) plus a "Choose file" button driving a visually hidden `<input type="file" accept=".csv">` (no `multiple`), so every action works by keyboard. The chosen file's name (and size in KB/MB) shows with a "Remove" icon button (aria-label + tooltip). The file field and the Kind field are marked required (`*`). Selecting Upload with no file chosen shows "Choose a file to upload." under the file field (checked on submit, BR8).
- **Kind.** shadcn Select labelled "Kind of file" with the single option "Bank transactions" (`BankTransactions`), preselected. Sent as the `kind` multipart field.
- **Upload transport (NFR-1).** New `uploadFile(file, kind, { onProgress, signal })` in `lib/api/upload.ts` using `XMLHttpRequest` to the same-origin `${API_BASE_URL}/files` (never `:5100`), `FormData` with fields `file` and `kind`, `xhr.upload.onprogress` -> percentage. Resolves with `UploadedFile` on 201. On failure it rejects with the same `APIError` shape as `apiClient` (statusCode, message, errors, body; network/abort/502-504 -> statusCode 0 `isNetworkError`) and applies the same central 401 handling (`redirectToSignIn(reason)`, `redirecting: true`), so screens keep using `lib/api/errors.ts`. Re-export from `endpoints.ts` as `uploadFile`. The proxy allowlist already has POST /files and streams the request body.
- **Progress (NFR-3).** shadcn Progress (`npx shadcn add progress --yes`) with a visible percentage and "Uploading <file name>…" text. The status region (`role=status`) announces the start and the finish, not every percent. While uploading, the file field, Kind and Upload are disabled.
- **Success (R5, BR7).** `showToast({ variant: 'success', title: '<file name> has been uploaded successfully.' })` (auto-dismisses). The form resets for the next file and a persistent "Last upload" line shows the file name with "View file details" (`fileDetailsHref(id)` -> `/dashboard/files/<id>`) and "Go to dashboard" links (R7).
- **Following processing (R7, R8, R9).** No new live code: the details and Dashboard already refetch on `file-changed` / `resync` and show status in words and the "Why it failed" duplicate reason verbatim (BR5, BR6).
- **Layout.** Single column; drop area full width; at 360px no horizontal scroll and the long file names wrap.
- **Privacy (NFR-4).** Never read the file's contents in the browser, never log the request body or file contents; only the file name may be shown.

## Acceptance criteria

- **AC-1** (coverage: vitest): The Importer's Upload screen shows a drop area with a "Choose file" control and the kind of file preselected as Bank transactions, both marked required; selecting Upload with no file chosen says a file is needed.
- **AC-2** (coverage: playwright): Choosing a file with "Choose file" (using the keyboard) or dropping one onto the drop area shows its name, ready to upload.
- **AC-3** (coverage: vitest): While the file uploads the screen shows its progress as a bar and a percentage, announces that the upload started and finished, and the controls cannot be used until it ends.
- **AC-4** (coverage: playwright): When the upload finishes the screen confirms "<file name> has been uploaded successfully.", the confirmation goes away by itself, and "View file details" opens that file's details.
- **AC-5** (coverage: none): A file whose content matches an earlier file is accepted, then its details and the Dashboard show it failed as a duplicate naming the earlier file, without refreshing (decided by the back-end; shown by the existing screens and their live-update tests).
- **AC-6** (coverage: playwright): At 360px wide the Upload screen has no horizontal scroll and choosing and uploading a file works by keyboard alone.

Additional technical checks (3):
- The upload goes to the same-origin `/api/files` as multipart with the fields `file` and `kind=BankTransactions`, never to the back-end address directly (NFR-1).
- A 401 during the upload leaves for sign-in with the reason through the shared handling, with no problem message shown (central session handling).
- The file's contents are never read or logged in the browser; only its name is shown (NFR-4).

## Manual test checklist

- Sign in as the Importer → you land on Upload, with a drop area, a "Choose file" button and the kind set to Bank transactions.
- Drag `TestFiles/transactions_2026-04-15.csv` onto the drop area and select Upload → a progress bar shows, then "transactions_2026-04-15.csv has been uploaded successfully." appears and fades after a few seconds.
- Select "View file details" straight away → the file shows Uploaded or Processing and changes to Completed (20 rows, 20 Imported) without you refreshing.
- Upload the same file again → it is accepted, then its details show Failed with "File is a duplicate of another file transactions_2026-04-15.csv".
- Using only the keyboard, tab to "Choose file", pick the file and upload it → it works without the mouse.
- Narrow the browser to phone width → the Upload screen fits with no sideways scrolling.
- Sign in as the Approver and type `/upload` in the address bar → you see the no-access message and no upload controls.

## Resolved design choices (defaults chosen; stories approval delegated)

- Choosing or dropping a file does not upload it at once: the file's name is shown and the Importer selects "Upload", so a wrong file can be removed first.
- "Kind of file" is shown as a select with the one option Bank transactions already chosen, so the choice is visible and ready for future kinds, but needs no action today.
- The confirmation is the shared self-closing success message; a "Last upload" line with "View file details" and "Go to dashboard" links stays on the screen so the Importer can follow the file after the message has gone.
- The Upload screen does not show live processing itself; the file is followed on its details screen and the Dashboard, as the brief describes.
- Progress is announced to screen readers when the upload starts and finishes, not at every percent, to avoid a flood of announcements.
- No "Cancel upload" button while uploading (not asked for; uploads of up to 10 MB are short).

## Infrastructure reuse notes

- **Access.** `RouteGuard route="/upload"`; `ROUTE_ACCESS` already restricts `/upload` to Importer and the menu already shows Upload to Importers only. No access-map change.
- **Proxy.** `BACKEND_ENDPOINTS` already allows POST /files and the `/api/[...path]` route streams request bodies (`duplex: 'half'`). No change.
- **Types.** `UploadedFile`, `UploadFileFormFields`, `FileKind` in `src/types/api-generated.ts`.
- **Errors.** Mirror the error shape built in `lib/api/client.ts` (`createNetworkError`, 401 via `redirectToSignIn` from `lib/auth/signIn.ts`, `UNREACHABLE_STATUSES`) inside the XHR helper rather than inventing a new error type; callers use `isNetworkError` / `isRedirectingToSignIn` / `statusOf`.
- **Feedback.** `useToast()` success variant; `fileDetailsHref` from `components/files/FilesList.tsx`; `dashboardListHref` from `lib/files/listReturn.ts` for "Go to dashboard".
- **Primitives.** shadcn Button, Select (with the type-ahead fix), Label, Tooltip (`TooltipProvider disableHoverableContent`), new Progress.
- **E2E mock.** Extend `app-frontend/e2e/fixtures/mock-backend.ts`: the Node server reads the body for POST /files (e.g. `new Request(url, { method, headers, body, duplex: 'half' }).formData()`), Importer session required (Approver -> 403 `{message}`), then answers per the contract order: not multipart -> 415 "Files must be uploaded as multipart/form-data."; more than one file -> 400 "Upload one file at a time."; no `file` -> 400 ValidationProblem under `file`; bad name -> 400 "Invalid file name"; not `.csv` -> 400 "Only .csv files can be uploaded. Please choose a .csv file."; larger than 10 MB -> 413 "The file is too large. Files can be up to 10 MB."; else 201 `UploadedFile` (new UUID, status Uploaded). Let `respondFor` accept the parsed upload so `page.route()` handlers can reuse it. The new file's details link can be served via a fixed seeded id or a spec-level `page.route()`.
