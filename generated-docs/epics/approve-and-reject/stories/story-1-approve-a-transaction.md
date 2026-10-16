# Story 1: Approve a transaction

- **Epic:** approve-and-reject
- **Slug:** story-1-approve-a-transaction
- **Roles:** Approver, Importer
- **Route:** /transactions
- **Page action:** modify_existing
- **Infrastructure only:** false
- **Requirement IDs:** R1, R3, R4, R5, R6, R7, R8, R9, BR1, BR2, BR3, BR6, BR9, BR10, GN-01, GN-02, GN-03, GN-05, NFR (status in words), NFR (no account numbers / descriptions in logs), NFR (same-origin proxy), NFR (error state with retry)
- **Target file:** app-frontend/src/app/(authenticated)/transactions/page.tsx

## Plain summary

On the Transactions list, an Approver sees Approve and Reject on every transaction that is still Imported, on a wide screen and on a phone. Selecting Approve asks for confirmation naming the transaction's reference, with Cancel as the default choice; confirming marks it Approved straight away with a short success message. If someone else already approved or rejected it, nothing changes and the Approver is told, with the transaction's current status shown.

## Technical summary

- **Role on the list.** The Transactions page passes the signed-in role (from `requireSession()`, as the Dashboard page does for `FilesList`) to `TransactionsList` as a `role` prop. Row actions render only for `role === 'Approver'` and `status === 'Imported'` (R1, BR1); hidden otherwise, never disabled.
- **Row actions component.** New `components/transactions/TransactionRowActions.tsx` holding the Approve trigger + `ApproveTransactionDialog` and (story 2) the Reject trigger + dialog. Desktop table: a new last "Actions" column (header "Actions", not sortable). Phone list: in the existing row-actions area after "Details" (the comment at TransactionsList.tsx line 251). Text buttons ("Approve", "Reject", outline, small) with a visually hidden " <reference>" suffix so each has a unique accessible name; not icon-only, so no tooltip (GN-03 satisfied by text). Both reachable at 360px without sideways scrolling (GN-01). The Reject trigger is rendered in this story and wired by story 2.
- **Confirmation (R6, BR3).** shadcn AlertDialog (already installed, as `CancelFileDialog`): title "Approve <reference>?", body "This marks the transaction as Approved. This can't be undone." Buttons "Cancel" (initial focus via `onOpenAutoFocus`) and "Approve". Escape / Cancel close with nothing sent; focus returns to the trigger (GN-02).
- **Approve (R7, R8, BR9, BR10).** `approveTransaction(id)`; while pending the confirm shows "Approving…" and both buttons are locked. On 200: close, success toast "<reference> approved." (auto-dismisses), replace the row with the returned `TransactionDetails` at once (status Approved, actions gone), then refetch the current view in place (so an active Status filter drops the row, BR9). Who and when come back in `lastChangedBy` / `lastChangedAt` and show on the details screen (R8).
- **Someone got there first (R9, BR6).** On 409: close the dialog; the row takes the `transaction` from the body (current status, actions gone); show a persistent error toast titled "Problem" with the body's `message` verbatim plus "It is now <Status in words>." and, when Rejected, "Reason: <rejectionReason>". The toast stays until dismissed (GN-05). No retry is offered. Shared helper `components/transactions/decisionConflict.ts` (reused by story 2).
- **Other failures (NFR error with retry).** Network / 5xx / other statuses: the dialog stays open with an inline `role=alert` problem and "Try again" resending the same request; 403 shows the server's message. Return early on `isRedirectingToSignIn`.
- **Hand-off for the badge.** After a successful approve or a 409, call the imported-count refresh hook introduced by story 3 (story 3 wires it; until then a no-op default).
- **Privacy.** Messages name only the reference and status; never log account numbers, descriptions or response bodies.

## Acceptance criteria

- **AC-1** (coverage: vitest): An Approver sees Approve and Reject on every Imported transaction in the list (table rows and phone rows) and on no Approved or Rejected one; an Importer sees neither on any transaction.
- **AC-2** (coverage: playwright): Selecting Approve asks for confirmation naming the transaction's reference with Cancel as the default choice; Cancel or Escape closes it with the transaction unchanged and focus back on Approve, all by keyboard.
- **AC-3** (coverage: playwright): Confirming approves the transaction: a self-closing message confirms it, the row shows Approved straight away without Approve or Reject, its details show who approved it and when, and with the Status filter set to Imported the row leaves the list.
- **AC-4** (coverage: playwright): Approving a transaction someone else already approved or rejected changes nothing: a message that stays until dismissed says so and gives the current status (and the reason when rejected), and the row updates to match.
- **AC-5** (coverage: vitest): While approving, the confirmation shows progress and cannot be confirmed twice; if the request fails for another reason, a problem with "Try again" shows in the still-open confirmation.
- **AC-6** (coverage: playwright): At phone width (360px) Approve and Reject are reachable from each Imported row without sideways scrolling, and approving from there works the same way.

Additional technical checks (3):
- Confirming sends exactly one `POST /transactions/{id}/approve` with no body through the same-origin `/api`; Cancel sends nothing.
- A 409 and a network / 5xx failure are handled differently (persistent conflict message, no retry vs. inline problem with Try again).
- Messages name only the reference and status, never account numbers or descriptions.

## Manual test checklist

- Sign in as the Approver and open Transactions → each Imported row shows Approve and Reject; Approved and Rejected rows show neither.
- Select Approve on an Imported row → a confirmation names its reference and Cancel is highlighted; press Enter → it closes and nothing changes.
- Select Approve again and confirm → a message confirms the approval and fades after a few seconds; the row now says Approved with no Approve or Reject.
- Open that transaction's details → it shows Approved, by Approver User, with the time.
- Open the same Imported transaction in two tabs; approve it in one, then try to approve it in the other → you are told it was already approved, the message stays until you close it, and the row shows Approved.
- Narrow the browser to phone width → Approve and Reject are on each Imported row and approving works without sideways scrolling.
- Sign in as the Importer → no Approve or Reject anywhere on Transactions.

## Resolved design choices (defaults chosen; stories approval delegated)

- Approve and Reject live on the Transactions list only (a new "Actions" column on wide screens, beside "Details" on phones); the transaction details screen stays read-only.
- The actions are text buttons at every width (not icons), each with the reference added for screen readers, so no hover labels are needed.
- After a decision the row changes at once from the server's answer, then the current view reloads in place, so a status filter drops the row.
- "Someone got there first" closes the confirmation and shows a lasting problem message with the server's wording and the current status; no retry is offered because the decision is final.
- A connection or server failure keeps the confirmation open with "Try again".

## Infrastructure reuse notes

- **Endpoints.** `approveTransaction(id)` in `lib/api/endpoints.ts` returns `TransactionDetails`; the proxy allowlist (`BACKEND_ENDPOINTS`) already has POST approve. 409 body `{ message, transaction }` arrives on `APIError.body` (`TransactionConflict` type in `src/types/api-generated.ts`).
- **List.** `TransactionsList` (table + `TransactionsCompactList` row-actions area), its in-place refetch; `TransactionStatusBadge`; `formatTransactionStatus`.
- **Dialog pattern.** Follow `CancelFileDialog` (AlertDialog, default-focused safe button, pending lock, inline `role=alert` + Try again, 409 -> close + persistent toast).
- **Feedback.** `useToast()` success / error; `statusOf` / `isNetworkError` / `isRedirectingToSignIn` from `lib/api/errors.ts`.
- **Role.** `requireSession()` in the server page to pass `role` down (as the Dashboard page does).
- **E2E mock.** Extend `app-frontend/e2e/fixtures/mock-backend.ts` with POST `/transactions/{id}/approve` with real semantics, scoped by the `mock-run` cookie: Approver only (403 `{message}` for Importer); Imported -> Approved with `lastChangedBy` = the signed-in name and `lastChangedAt` = now, returns `TransactionDetails`; otherwise 409 `{ message: "This transaction has already been approved." | "This transaction has already been rejected.", transaction }`. Specs simulate "someone else first" by approving through the mock (a second request in the same run) before the UI confirms.
