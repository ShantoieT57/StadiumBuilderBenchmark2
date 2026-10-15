# Epic: Correcting and cancelling files

Inherits roles, auth, data source, compliance, and styling from project.md.

**Epic slug:** `file-correction-and-cancel`
**Depends on:** `file-dashboard-and-details`, `file-upload`

## Goal

Importers fix the rows the app couldn't accept and have the file checked again, or cancel a file they can't fix. Cancelled files are hidden unless chosen.

Source of truth for the rule text: `documentation/Transaction-Import-and-Approval-Brief.md`. Rule IDs are kept so they can be traced and tested.

## Data Model

Shapes come from `app-backend/docs/TransactionApi.yaml`, which is authoritative. Confirm exact field names against it during BUILD.

| Entity | Used for | Notes |
|---|---|---|
| File | Status (Uploaded / Processing / Completed / Failed), failure reason (duplicate vs invalid rows), cancelled state, whether it has approved transactions | Already consumed by the dashboard and file details epic. Cancelling changes its state. |
| InvalidRow | One row that broke a row rule | Every column from the file (Reference, TransactionDate, AccountNumber, Description, Amount, TransactionType, Currency) plus every reason it failed (FP-04). |
| RowCorrection | The importer's edited values for one invalid row | Sent in `PATCH /files/{id}/invalid-rows` as `{rows:[RowCorrection]}` and in `POST /files/{id}/recheck` as `{corrections:[RowCorrection]}`. |
| RecheckResult | Outcome of a re-check | `{status, file, invalidRows}`: the file's new status, the updated file, and the rows that still fail. |

API calls for this epic (relative to `http://localhost:5100/api`, through the Next.js proxy per NFR-base-6):

- `GET /files/{id}/invalid-rows`: Importer only. 409 when the file is not waiting for corrections.
- `PATCH /files/{id}/invalid-rows`: Importer only. Saves corrections without re-checking. 409 when the file is not waiting.
- `POST /files/{id}/recheck`: Importer only. Body `{corrections:[...]}`. Returns `{status, file, invalidRows}`.
- `POST /files/{id}/cancel`: Importer only. 409 with an explanation when the file has approved transactions. Idempotent for an already-cancelled file.

Validation errors (400) use camelCase JSON-path keys, for example `corrections[0].amount`. Map these back to the matching row and field on the correction form.

## Functional Requirements

Each requirement is the brief's rule with that ID, quoted exactly. Local numbering `R1..R17` is for this epic only.

- **R1 (FC-01):** For a file with invalid rows, the file's detail screen lists only the invalid rows, with every column from the file and the reason each row failed.
- **R2 (FC-02):** The importer can change the values on an invalid row and then ask the app to check the file again.
- **R3 (FC-03):** Checking again repeats stages 4 to 7. If every row now passes, the file loads and becomes **Completed**. If any row still fails, the file stays **Failed** and the list shows the rows that still fail and how many remain.
- **R4 (FC-04):** If the importer cannot correct the file, they cancel it (rules FX-01 to FX-06).
- **R5 (FX-01):** Before cancelling, the app asks for confirmation and names the file. The safe choice, keeping the file, is the default.
- **R6 (FX-02):** The app refuses to cancel a file that has at least one **Approved** transaction, and explains why.
- **R7 (FX-03):** Cancelling a file removes its transactions from the app, so they no longer appear in the transactions list, the summaries, or exports. Because they are removed, a corrected file with the same references can be uploaded later.
- **R8 (FX-04):** Cancelling a file also discards the app's copy of the original file, so it can no longer be downloaded. A file waiting for corrections stops waiting.
- **R9 (FX-05):** A cancelled file is hidden from the dashboard unless the person chooses to show cancelled files.
- **R10 (FX-06):** Cancelling a file that someone else has already cancelled does nothing and shows the file as cancelled.
- **R11 (FS-01):** A file that failed as a duplicate stays failed. It cannot be retried.
- **R12 (FS-02):** A file that failed because of invalid rows can be corrected and checked again (rule FC-02).
- **R13 (FP-03):** A row is invalid when it breaks any of the row rules below.

  | Rule | Reason shown on the row |
  |---|---|
  | The transaction type is `C` or `D`. | Invalid Transaction Type |
  | The date can be read as a date and time. | Invalid Transaction Date |
  | The amount is a number, not negative, with up to two decimal places. | Invalid Amount |
  | The account number is not empty. | Missing Account Number |
  | The reference appears only once in the file, ignoring upper and lower case. | Duplicate Reference In File |

- **R14 (FP-04):** Each invalid row carries every reason it failed, not only the first.
- **R15 (FP-06):** A file is all or nothing. While any row is invalid, nothing from the file is loaded.
- **R16 (DB-08):** Importer only: a file that failed because of invalid rows offers a way to its correction screen straight from the list.
- **R17 (FD-08):** Importer only: the cancel action.

## Business Rules

- **BR1:** The correction list and the correction/re-check actions apply only to a file that failed because of invalid rows. A duplicate-failed file (FS-01) shows no correction or re-check action, and gets no DB-08 shortcut.
- **BR2:** The importer-only controls (correction form, re-check, DB-08 shortcut, FD-08 cancel action) are hidden, not disabled, for approvers (AC-01). The back-end also enforces this (AC-03). A disallowed correction screen reached by a saved link shows the no-access message naming who to ask (AC-02).
- **BR3:** The cancel dialog defaults focus to keeping the file (FX-01). Cancelling needs an explicit confirmation naming the file.
- **BR4:** A cancel refused because the file has approved transactions (409) shows the back-end's explanation and persists until dismissed (GN-05), and the file stays active.
- **BR5:** Cancelling a file already cancelled by someone else (idempotent, FX-06) is treated as success: the file is shown as cancelled with no error.
- **BR6:** A 409 on the invalid-rows endpoints means the file is no longer waiting for corrections (for example it was cancelled elsewhere). Show a clear message and refresh the file's current state instead of the form.
- **BR7:** Per GN-04, required correction fields are marked. Each field is checked when the person leaves it and again on submit, not on every keystroke. Client-side checks mirror the row rules (type `C`/`D`, readable date, non-negative amount with at most two decimals, non-empty account number, reference unique in the file ignoring case). The back-end result stays authoritative.
- **BR8:** After a re-check that still fails, the list shows only the rows that still fail with all their reasons, and the count remaining (FC-03).
- **BR9:** After a successful cancel, the file disappears from the default (active) dashboard list and appears when the person chooses cancelled or both (FX-05, built on the DB-06 control from the dashboard epic). Its original file can no longer be downloaded (FX-04).
- **BR10:** Success messages (for example a re-check that completes the file, or a cancel) disappear on their own after a few seconds. Problems stay on screen until resolved (GN-05).
- **BR11:** Status is always shown in words, never colour alone (FS-03).

## Key Workflows

1. **Correct and re-check a file (importer):**
   1. Importer sees a Failed file with invalid rows, either via the DB-08 shortcut on the dashboard list or by opening file details (FD-06).
   2. The correction screen lists only the invalid rows, with every column and every failure reason.
   3. Importer edits values on one or more rows. Fields are validated on blur and on submit (GN-04).
   4. Importer asks for the file to be checked again (`POST /files/{id}/recheck` with the corrections).
   5. If every row passes, the file becomes Completed and its transactions load. Otherwise the file stays Failed and the screen shows the rows that still fail and how many remain.
2. **Save corrections without re-checking (optional):** the API's `PATCH /files/{id}/invalid-rows` saves edits so they are not lost. Whether to surface this as a distinct "Save" action or fold it into re-check is decided at stories time. Re-check is the required path.
3. **Cancel a file (importer):**
   1. Importer chooses Cancel on file details (FD-08), or on a file they cannot correct (FC-04).
   2. A confirmation names the file, with keeping the file as the default choice.
   3. On confirm, the app cancels the file. If the file has approved transactions, the app refuses and explains.
   4. On success the file is shown as cancelled and drops out of the active list.
4. **Show cancelled files (any role):** the dashboard's active/cancelled/both control (DB-06) reveals cancelled files, which then appear as cancelled.
5. **Approver view:** an approver sees none of the correction or cancel controls, and a saved link to a correction screen shows the no-access message.

## Feature NFRs

- **NFR-1:** The correction form is usable on a phone: on a narrow screen each invalid row shows its key details and keeps its edit actions available (GN-01).
- **NFR-2:** The correction form, re-check, and cancel flow are fully operable by keyboard, including the confirmation dialog (GN-02), and icon-only buttons carry tooltips (GN-03).
- **NFR-3:** Re-check and cancel show a progress/pending state and block double submission. A failed call shows an error with a retry (NFR-base-5).
- **NFR-4:** Original file rows contain account numbers and descriptions. These MUST NOT appear in client-side logs, analytics, or error payloads (POPIA).
- **NFR-5:** The file's new state after re-check or cancel should show without a manual refresh, using the `file-changed` SSE event and the existing resync handling.

## Out of Scope

- Correcting files that failed as duplicates (FS-01: cannot be retried).
- Uploading a corrected file. That is the upload epic. This epic only makes the "same references can be uploaded later" outcome (FX-03) possible.
- Reviewing, approving, rejecting, or exporting transactions.
- Any change to the back-end API.

## Notes & Caveats

- The dashboard's active/cancelled/both control (DB-06), the file list, and file details (FD-06 failure reason, FD-07, download) are built in `file-dashboard-and-details`. This epic adds the importer-only DB-08 shortcut and the FD-08 cancel action to those screens and reuses the visibility control for FX-05.
- Download of a cancelled file's original returns 410 (FX-04). File details must not offer a working download for a cancelled file.
- No design source exists, so layout is decided at stories/BUILD using Shadcn primitives (dialogs, inputs, tables).
