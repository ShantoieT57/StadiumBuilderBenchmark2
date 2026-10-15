# Approving and rejecting transactions

Inherits roles, auth, data source, compliance, and styling from project.md.

Depends on: `transactions-list` (the transactions list, its row actions area, and the Transactions menu item already exist).

## Goal

Approvers approve or reject each waiting transaction (a reason is required to reject), see the list update straight away, are told when someone else got there first, and see how many are still waiting on the menu.

## Data Model

From `app-backend/docs/TransactionApi.yaml` (authoritative). Scoped to this epic.

**Transaction (existing, from the list):** reference, date and time, account number, description, amount, currency, transaction type (Credit/Debit), status (`Imported` | `Approved` | `Rejected`), file, rejection reason (only on a rejected transaction), last changed by, last changed on.

**ApproveTransaction request:** `POST /transactions/{transactionId}/approve`, no body. Approver only. Returns the updated transaction.

**RejectTransaction request:** `POST /transactions/{transactionId}/reject`, body `{ reason: string }`. Reason is 1 to 500 characters after trimming. A 400 carries the validation key `reason`. Approver only. Returns the updated transaction.

**ConflictResponse (409, both endpoints):** `{ message: string, transaction: Transaction }`, where `transaction` holds the current status (and rejection reason when rejected).

**ImportedCount:** `GET /transactions/imported-count` returns `{ count: number }`. Approver only.

**Events (from the shell's `/events` SSE connection):** `transactions-changed` (refresh the badge and any visible list), `resync` (refetch).

## Functional Requirements

Each requirement quotes the source brief rule exactly. The source rule ID is shown for traceability.

- **R1 (TL-04):** An approver sees **Approve** and **Reject** on every **Imported** transaction, and on no other.
- **R2 (TL-07):** For approvers, the Transactions menu item shows how many transactions are still **Imported**. It shows the exact number up to 99, then "99+", and nothing when the number is zero.
- **R3 (TS-02):** Only an **Imported** transaction can be approved or rejected.
- **R4 (TS-03):** **Approved** and **Rejected** are final. Nothing can change a transaction once it reaches either.
- **R5 (TS-04):** The app enforces TS-02 and TS-03 itself. Hiding the buttons is not enough: no route through the app may change a final transaction.
- **R6 (AP-01):** Before approving, the app asks for confirmation and names the transaction's reference. Cancelling is the default choice.
- **R7 (AP-02):** On confirmation, the status becomes **Approved** and the list updates straight away. A short message confirms the approval.
- **R8 (AP-03):** The app records who approved the transaction and when.
- **R9 (AP-04):** If someone else approved or rejected the transaction first, the app does not change it. It tells the approver and shows the transaction's current status.
- **R10 (RJ-01):** Rejecting asks for a reason. The reason is required, and the app does not let the approver submit until they have entered one.
- **R11 (RJ-02):** The reason can be up to 500 characters. The app shows how many characters remain.
- **R12 (RJ-03):** On submission, the status becomes **Rejected**, the reason is stored with the transaction, and the list updates straight away. A short message confirms the rejection.
- **R13 (RJ-04):** The app records who rejected the transaction and when.
- **R14 (RJ-05):** If someone else approved or rejected the transaction first, the app does not change it. It tells the approver and shows the transaction's current status.

## Business Rules

- **BR1:** Approve and Reject are Approver only. An Importer never sees them (TL-05, AC-01), and the back-end enforces this (AC-03).
- **BR2:** The front-end never sends approve or reject for a transaction it knows is not **Imported**. Final states are still enforced by the server, so TS-04 surfaces in the front-end as handling the 409 correctly (BR6), not as a separate client-side check.
- **BR3:** The approve confirmation names the transaction's reference, and Cancel is the default (focused) choice (R6).
- **BR4:** The reject reason is trimmed before it is judged. It must be 1 to 500 characters after trimming. The remaining-characters count follows the server's counting, which is JavaScript string length (R11). Submit stays unavailable while the trimmed reason is empty (R10).
- **BR5:** A server 400 on `reason` is shown against the reason field.
- **BR6:** On a 409 from approve or reject, the transaction is not changed. Show the `message`, show the transaction's current status from the response (and its rejection reason if it was rejected), and update that row in the list to match. This is a problem needing attention, so it stays on screen until dismissed or resolved (GN-05).
- **BR7:** The Transactions menu badge shows the exact count up to 99, "99+" above 99, and is hidden at zero. It is shown to Approvers only.
- **BR8:** The badge comes from `GET /transactions/imported-count`. Keep it current: refetch on `transactions-changed` and on `resync` from the shell's `/events` connection, and after this approver's own approve or reject.
- **BR9:** After a successful approve or reject, the affected row updates straight away without a manual refresh. If a status filter is active, the row leaves the list when it no longer matches.
- **BR10:** Success confirmations disappear on their own after a few seconds (GN-05).

## Key Workflows

1. **Approve:** The approver selects Approve on an Imported transaction. A confirmation names the reference, with Cancel as the default. On confirm, the status becomes Approved, the list row and the menu badge update, and a short success message appears.
2. **Reject:** The approver selects Reject on an Imported transaction. A reason form appears with a required, marked field and a remaining-characters count. Submit is unavailable until a reason is entered. On submit, the status becomes Rejected with the reason stored, the list and badge update, and a short success message appears.
3. **Someone got there first:** The approver confirms an approval or rejection, but the server answers 409. The app changes nothing, tells the approver, and shows the transaction's current status. The list row and badge refresh to match.
4. **Badge stays current:** Another person's approval or rejection arrives as `transactions-changed` on the shell's `/events` connection. The badge refetches. On `resync`, the badge and the visible list refetch.
5. **On a phone:** The same actions are reachable on a narrow screen from each row, without hiding them behind a desktop-only layout.

## Feature NFRs

- Inherits GN-01..GN-05, restated for this epic:
  - **GN-01:** The app works on a phone as well as on a desktop. On a narrow screen, lists show the key details of each row and keep its actions available. Approve and Reject must stay usable at 360px.
  - **GN-02:** Every action can be done with the keyboard alone. The confirmation and reason dialogs are fully keyboard operable, with focus trapped and then returned to the triggering control on close.
  - **GN-03:** Every icon-only button has a label that appears when the person points at it or moves to it with the keyboard. If Approve or Reject render as icons on narrow screens, they carry labels.
  - **GN-04:** Required fields on a form are marked. The app checks a field when the person leaves it and again when they submit, not on every keystroke. The remaining-characters count may update as the person types, since it is a counter and not validation.
  - **GN-05:** Success messages disappear on their own after a few seconds. Problems that need attention stay on screen until resolved.
- Status is conveyed in words, never colour alone (FS-03).
- Account numbers and descriptions never go to client logs or error-reporting payloads (project.md Compliance).
- The browser calls the back-end only through the Next.js same-origin proxy (NFR-base-6).
- Every async action has a user-visible error state with retry (NFR-base-5), for example a 5xx or a network failure on approve or reject. Distinguish these from the 409 case.

## Out of Scope

- Exporting transactions, which is its own epic.
- The transactions list, filters, sorting, and paging, which come from `transactions-list`.
- Bulk approve or reject. Actions apply to one transaction at a time.
- Editing or undoing a decision. Approved and Rejected are final (TS-03).
- Changing the shell's `/events` connection itself. This epic only subscribes to it.

## Notes & Caveats

- No design digest exists for this project, so there are no translate-not-copy notes.
- The back-end already enforces TS-02 and TS-03 and returns 409 for a transaction that is no longer Imported. The front-end must not duplicate that logic beyond hiding the actions (TL-04), and must handle the 409 correctly.
- Back-end changes, if any are needed, go through the `backend-workflow` sub-agent per `CLAUDE.backend.md`.
