# Story 2: Refused files and failed uploads

- **Epic:** file-upload
- **Slug:** story-2-refused-and-failed-uploads
- **Roles:** Importer
- **Route:** /upload
- **Page action:** modify_existing
- **Infrastructure only:** false
- **Requirement IDs:** R3, R4, R6, BR2, BR3, BR4, BR7, NFR-2, NFR-3, NFR-4
- **Target file:** app-frontend/src/app/(authenticated)/upload/page.tsx

## Plain summary

When the Importer picks a file the app cannot take, the Upload screen says why in plain words and lets them choose another file: a file that is not a `.csv` ("Only .csv files can be uploaded. Please choose a .csv file."), a bad file name ("Invalid file name"), several files at once ("Upload one file at a time.") or a file over 10 MB ("The file is too large. Files can be up to 10 MB."). When the server refuses a file its own message is shown word for word. If the connection drops part way, the screen says the upload failed and offers "Try again".

## Technical summary

- **Client pre-checks (BR2).** On choose or drop, before any request: not ending in `.csv` (any case) -> "Only .csv files can be uploaded. Please choose a .csv file."; empty name, over 255 characters, or containing `..`, `\`, `/` or `:` -> "Invalid file name"; more than one file dropped -> "Upload one file at a time." Wording is identical to the server's. The rules live in `lib/validation/upload.ts` (a small Zod schema / pure function) so they are tested once. No client size check: the maximum is configured on the server, so 413 is the server's message.
- **Server refusals (BR3).** On 400 with `message`, 413 or 415: show the server's `message` verbatim. On 400 ValidationProblem: show its messages verbatim (all `errors` values). On 403: the server's message (names the administrator). Any other non-network status: a generic "The file could not be uploaded." with Try again.
- **Showing a refusal (BR7, NFR-3).** Inline under the file field, `role=alert`, linked to the field by `aria-describedby`; it stays until the Importer chooses another file or removes the file (never auto-dismisses). The refused file is cleared so the Importer chooses again.
- **Failed part way (R6).** Network error / abort / 502-504 (`isNetworkError`): inline `role=alert` "The upload of <file name> failed. Check your connection and try again." with a "Try again" button that re-sends the same file and kind; on success the normal confirmation from story 1 follows. Return early on `isRedirectingToSignIn` (no message).
- **One at a time (BR4).** While an upload is in progress the field and Upload stay disabled (from story 1); a drop during an upload is ignored.
- **Privacy (NFR-4).** Messages name the file only; never echo file contents or row data.

## Acceptance criteria

- **AC-1** (coverage: playwright): Choosing a file that is not a `.csv` file is refused before uploading with "Only .csv files can be uploaded. Please choose a .csv file.", and the Importer can then choose another file.
- **AC-2** (coverage: vitest): A file whose name is too long or contains `..`, `\`, `/` or `:` is refused with "Invalid file name" without being uploaded.
- **AC-3** (coverage: playwright): Dropping several files at once is refused with "Upload one file at a time." and nothing is uploaded.
- **AC-4** (coverage: vitest): When the server refuses a file (a refused name or type, too large, wrong format, or a missing file), the screen shows the server's message word for word, and it stays on screen until the Importer chooses another file.
- **AC-5** (coverage: playwright): When the connection drops part way through an upload the screen says the upload failed and offers "Try again", which uploads the same file again and confirms it on success.
- **AC-6** (coverage: vitest): A refusal or failure message is announced to screen readers and is tied to the file field.

Additional technical checks (2):
- The client-side refusal wording is identical to the server's messages, and checks run on choose/drop and on submit, not on every keystroke (BR2, BR8).
- Refusal and failure messages contain only the file name, never file contents (NFR-4).

## Manual test checklist

- Choose a `.txt` or `.xlsx` file → you see "Only .csv files can be uploaded. Please choose a .csv file." and can choose another file.
- Drag two `.csv` files onto the drop area together → you see "Upload one file at a time."
- Choose a `.csv` file larger than 10 MB and upload it → you see "The file is too large. Files can be up to 10 MB."
- Start uploading a file and stop the back-end (or switch the network off in the browser's developer tools) mid-way → you see that the upload failed and a "Try again" button; restore the connection and select it → the file uploads and is confirmed.
- After a refusal, wait → the message stays until you choose another file.
- At phone width, trigger a refusal → the message is readable with no sideways scrolling.

## Resolved design choices (defaults chosen; stories approval delegated)

- Refusals and failures are shown inline under the file field (not as a pop-up message), because they belong to the chosen file and must stay until resolved.
- `.csv` and file-name problems are caught as soon as the file is chosen or dropped, with exactly the server's wording; the size limit is left to the server, since the limit is configured there and its message names the size.
- After a refusal the refused file is cleared so the Importer chooses again; after a failed connection the file is kept so "Try again" re-sends it without choosing again.
- An unexpected server problem (not one of the known refusals) shows "The file could not be uploaded." with "Try again".

## Infrastructure reuse notes

- **Transport.** `uploadFile` from story 1 (`lib/api/upload.ts`); errors via `isNetworkError` / `isRedirectingToSignIn` / `statusOf` from `lib/api/errors.ts`; `APIError.errors` carries ValidationProblem messages and `APIError.message` the server message.
- **Validation.** New `lib/validation/upload.ts`, alongside `fileFilters.ts`; extend `src/__tests__/integration/validation-schemas.test.ts` style if useful.
- **Form conventions.** Field errors linked by `aria-describedby`; required `*`; feedback that belongs to a field stays inline (problem toasts are for feedback not tied to a field).
- **E2E.** Refusals the browser pre-checks never reach the server. Server refusals and 413 use the mock back-end's POST /files (story 1) or a spec-level `page.route('**/api/files')` with `respondFor`; the mid-upload failure uses `route.abort('connectionreset')`, then lets the retry through.
