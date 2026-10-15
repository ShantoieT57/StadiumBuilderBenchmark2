# Epic: File upload

Inherits roles, auth, data source, compliance, and styling from project.md.

Depends on: `file-dashboard-and-details`.

## Goal

Importers upload the daily transaction file, see its progress and a confirmation, are told clearly when a file is refused or is a duplicate, and watch processing finish without refreshing.

This epic replaces the importers' placeholder landing page (Upload) from the shell epic. Only importers upload files (Approvers do not see the Upload menu item and a direct visit shows the no-access message per AC-01 / AC-02).

## Data Model

Entities this epic introduces or uses (from `app-backend/docs/TransactionApi.yaml`, which is authoritative):

- **Upload request** (`POST /files`, multipart): field `file` (the CSV) plus optional `kind` (default `BankTransactions`, the only kind today).
- **File** (response of `POST /files` on 201, and the shape shown on the dashboard and file details from `file-dashboard-and-details`): file name, status (`Uploaded` | `Processing` | `Completed` | `Failed`), failure reason (including the duplicate reason naming the earlier file), row count, last processed time, processing history.
- **Upload error**: 400 (messages "Invalid file name", "Only .csv files can be uploaded. Please choose a .csv file.", "Upload one file at a time."), 413 ("The file is too large. Files can be up to 10 MB."), 415.
- **Live events**: `/events` SSE `file-changed` (and `resync`, `session-ended`) from the shell epic.

## Functional Requirements

- **R1 (UP-01):** The importer can drag a file onto the Upload screen or choose it from their computer.
- **R2 (UP-02):** The importer chooses what kind of file it is. There is one kind today, **Bank transactions**, and the app selects it for them.
- **R3 (UP-03):** The app accepts only `.csv` files. When it refuses a file, the message says what kind of file it expects.
- **R4 (UP-04):** The file name must not be empty, must be 255 characters or fewer, and must not contain `..`, `\`, `/`, or `:`. Otherwise the app refuses the upload with the message "Invalid file name".
- **R5 (UP-05):** While the file uploads, the screen shows progress. When the upload finishes, the app confirms with "<file name> has been uploaded successfully."
- **R6 (UP-06):** If the upload fails part way, the app says so and lets the importer try again.
- **R7 (UP-07):** An upload only hands the file over. Checking and loading happen afterwards, and the importer follows them on the dashboard and the file's detail screen without having to refresh.
- **R8 (FP-01):** A file is a duplicate when its content is identical to another file that is uploaded, processing, completed, or waiting for corrections. Earlier files that were cancelled or that failed as duplicates do not count. A file with no transaction rows is never treated as a duplicate.
- **R9 (FP-02):** A duplicate file fails with a message naming the earlier file, for example "File is a duplicate of another file transactions_2026-04-15.csv".

## Business Rules

- **BR1:** Only importers upload. The Upload menu item and actions are hidden from approvers (AC-01); a direct visit shows the no-access message naming who to ask (AC-02); the back-end enforces it (AC-03).
- **BR2:** The front-end may pre-check UP-03 (`.csv` only) and UP-04 (file name) client-side, but when the server refuses a file it must show the server's message verbatim.
- **BR3:** The server's 400, 413 and 415 responses are all surfaced to the importer as clear refusals. Server messages in use: "Invalid file name", "Only .csv files can be uploaded. Please choose a .csv file.", "Upload one file at a time.", "The file is too large. Files can be up to 10 MB."
- **BR4:** Only one file is uploaded at a time ("Upload one file at a time.").
- **BR5:** A duplicate file stays failed and cannot be retried (FS-01). It surfaces as the duplicate failure reason on the dashboard and file details once processing finishes (R8 and R9 are observed there, not decided by the front-end).
- **BR6:** File status is always shown in words, never by colour alone (FS-03).
- **BR7:** Success messages disappear on their own after a few seconds; refusals and failures that need attention stay on screen until resolved (GN-05).
- **BR8:** Required fields are marked and checked on leaving the field and on submit, not on every keystroke (GN-04).

## Key Workflows

1. Upload a valid file: importer lands on Upload (SI-05), drags a file onto the screen or chooses one, the kind is preselected as Bank transactions, progress is shown while uploading, then "<file name> has been uploaded successfully." appears. The importer follows the file on the dashboard / details as it moves Uploaded, Processing, then Completed, with no refresh.
2. Refused file: the importer picks a non-`.csv` file, a bad file name, several files, or a file over 10 MB. The screen shows the message (the server's wording) and lets them choose another file.
3. Failed upload: the connection drops part way. The screen says the upload failed and offers to try again.
4. Duplicate: the importer uploads the same file again (for example the supplied `transactions_2026-04-15.csv`). The upload is accepted, then the file fails as a duplicate, and the dashboard and file details show the reason naming the earlier file.
5. Live follow: `file-changed` events update the dashboard and file details as processing finishes. On `resync` the screens refetch; on `session-ended` the person returns to sign-in.

## Feature NFRs

- **NFR-1:** Upload progress needs a request mechanism that reports upload progress (the shared fetch-based API client does not), and it must still go through the same-origin Next.js proxy. The browser never calls `:5100` directly.
- **NFR-2:** Drag-and-drop has a keyboard-operable alternative (choose-file control) so every action works with the keyboard alone (GN-02); icon-only buttons have labels on hover and focus (GN-03).
- **NFR-3:** Upload progress and result messages are announced to assistive technology and work on a phone-width screen (GN-01).
- **NFR-4:** Original uploaded files contain account numbers. File contents and account numbers must not appear in client-side logs or error payloads (POPIA / PCI-DSS from project.md).

## Out of Scope

- Configuring file kinds (Bank transactions is the only, fixed kind).
- Collecting files from a shared folder.
- Correcting invalid rows, re-checking and cancelling files (separate epics).
- Building the dashboard and file details screens themselves (from `file-dashboard-and-details`; this epic only feeds them via upload and live events).

## Notes & Caveats

- The supplied example file `TestFiles/transactions_2026-04-15.csv` must be accepted as is; into an empty app it gives status Completed, 20 rows, 20 Imported. Uploading it again fails as a duplicate (FP-01).
- The upload goes through the same-origin proxy; the back-end sends no CORS headers (NFR-base-6).
- UP-07 relies on the shell's `/events` `file-changed` events.
- Inherit the GN conventions (GN-01 to GN-05).
