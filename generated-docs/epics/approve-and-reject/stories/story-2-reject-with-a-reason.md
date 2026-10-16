# Story 2: Reject a transaction with a reason

- **Epic:** approve-and-reject
- **Slug:** story-2-reject-with-a-reason
- **Roles:** Approver
- **Route:** /transactions
- **Page action:** modify_existing
- **Infrastructure only:** false
- **Requirement IDs:** R3, R4, R5, R10, R11, R12, R13, R14, BR2, BR4, BR5, BR6, BR9, BR10, GN-02, GN-04, GN-05, NFR (no account numbers / descriptions in logs), NFR (error state with retry)
- **Target file:** app-frontend/src/components/transactions/TransactionRowActions.tsx

## Plain summary

Selecting Reject on an Imported transaction opens a form naming its reference with a required reason and a count of characters left (up to 500). Reject stays unavailable until a reason is typed. Submitting marks the transaction Rejected with the reason kept, the list updates straight away and a short message confirms it. If someone else got there first, nothing changes and the Approver is told the current status.

## Technical summary

- **Trigger.** The Reject button rendered by story 1 in `TransactionRowActions` opens a new `components/transactions/RejectTransactionDialog.tsx` (shadcn Dialog, `npx shadcn add dialog --yes` if missing, plus Textarea / Label). Focus moves to the reason field on open, is trapped, and returns to Reject on close (GN-02).
- **Form (R10, R11, BR4, GN-04).** react-hook-form + zod (`mode: 'onBlur'`, `reValidateMode: 'onBlur'`), schema `lib/validation/rejectReason.ts`. Title "Reject <reference>?". Field "Reason" with `required` + visible `*`. Rule: trimmed value 1 to 500 characters, counted with JavaScript `.length` (UTF-16, matching the server). Problems "Enter a reason for rejecting." / "The reason can be at most 500 characters." under the field, linked by `aria-describedby`. A live counter "<N> characters left" (from 500 minus the trimmed length; "<N> characters too many" when over) updates as the person types, in a polite live region throttled to avoid chatter; the field is not hard-capped so a paste is never silently cut. The "Reject" submit is disabled while the trimmed reason is empty (R10); "Cancel" closes with nothing sent.
- **Reject (R12, R13, BR9, BR10).** `rejectTransaction(id, { reason: trimmed })`; pending "Rejecting…" with both buttons and the field locked. On 200: close, success toast "<reference> rejected." (auto-dismisses), replace the row with the returned `TransactionDetails` (Rejected, actions gone), then refetch the current view in place. The details screen shows the stored reason, who and when (existing `TransactionDetailsView`).
- **Server refusal on the reason (BR5).** 400 with `errors.reason` (key compared case-insensitively) -> `setError('reason')` under the field; other 400 keys in one inline `role=alert` above the buttons.
- **Someone got there first (R14, BR6).** 409 -> the shared `decisionConflict` helper from story 1: close, update the row from `transaction`, persistent "Problem" toast with the message, current status and (when Rejected) its reason.
- **Other failures.** Network / 5xx / other: inline `role=alert` + "Try again" in the open dialog, the typed reason kept; 403 shows the server message. Return early on `isRedirectingToSignIn`. Refresh the imported-count badge (story 3 hook) after success or 409.
- **Privacy.** Never log the reason, account numbers or descriptions.

## Acceptance criteria

- **AC-1** (coverage: playwright): Selecting Reject opens a form naming the reference with a required, marked Reason field and a count of characters left out of 500 that updates as the Approver types; Reject is unavailable until a reason is entered, Cancel or Escape closes it with nothing changed and focus back on Reject, all by keyboard.
- **AC-2** (coverage: vitest): The reason is checked when the Approver leaves the field and on submit: only spaces is refused as missing, more than 500 characters after trimming is refused as too long, and the count ignores leading and trailing spaces and counts characters the way the server does.
- **AC-3** (coverage: playwright): Submitting a reason rejects the transaction: a self-closing message confirms it, the row shows Rejected straight away without Approve or Reject, and its details show the reason, who rejected it and when.
- **AC-4** (coverage: vitest): A reason the server refuses is shown under the Reason field, and the form stays open with the typed reason.
- **AC-5** (coverage: playwright): Rejecting a transaction someone else already approved or rejected changes nothing: a message that stays until dismissed says so and gives the current status, and the row updates to match.
- **AC-6** (coverage: vitest): While rejecting, the form shows progress and cannot be submitted twice; if the request fails for another reason, a problem with "Try again" shows and the typed reason is kept.

Additional technical checks (3):
- Submitting sends one `POST /transactions/{id}/reject` with `{ reason }` trimmed; Cancel sends nothing.
- A server problem keyed `reason` lands under the field; other keys show above the buttons.
- The reason, account numbers and descriptions never appear in browser logs or error messages.

## Manual test checklist

- As the Approver, select Reject on an Imported row → a form names its reference, Reason is marked required, it says "500 characters left", and Reject is greyed out.
- Type a few words → the count goes down as you type; clear it and press Tab → a problem says a reason is needed.
- Type only spaces → Reject stays unavailable.
- Enter a reason and select Reject → a message confirms the rejection and fades; the row now says Rejected with no Approve or Reject.
- Open that transaction's details → it shows Rejected, your reason, Approver User and the time.
- Open the same Imported transaction in two tabs, approve it in one, then reject it in the other → you are told it was already approved, the message stays until you close it, and the row shows Approved.
- Do all of the above with the keyboard alone → focus stays inside the form while open and returns to Reject when it closes.

## Resolved design choices (defaults chosen; stories approval delegated)

- The reason is asked for in a small dialog over the list (not a separate screen), with focus starting in the Reason field.
- The count shows characters left after trimming, out of 500; the field is not hard-capped, so pasted text over the limit shows "N characters too many" and is refused when the Approver leaves the field or submits, rather than being cut silently.
- Reject is greyed out while the reason is empty or only spaces; the length rule is checked on leaving the field and on submit.
- The reason is sent trimmed.
- Conflict and failure handling match Approve (story 1).

## Infrastructure reuse notes

- **Endpoints.** `rejectTransaction(id, { reason })` in `lib/api/endpoints.ts` (`RejectTransactionRequest`); proxy allowlist already has POST reject. `APIError.errors` carries the 400 `reason` key.
- **Shared with story 1.** `TransactionRowActions`, the `decisionConflict` helper, the row replace + in-place refetch, the badge refresh hook.
- **Forms.** react-hook-form `mode: 'onBlur'` + zod, required `*`, `aria-describedby` (as `CorrectionsView` / `FileFilters`); shadcn Dialog, Textarea, Label, Button (add with the shadcn CLI if missing).
- **Feedback.** `useToast()`; `statusOf` / `isNetworkError` / `isRedirectingToSignIn`.
- **E2E mock.** Extend `app-frontend/e2e/fixtures/mock-backend.ts` with POST `/transactions/{id}/reject` with real semantics, scoped by `mock-run`: Approver only (403 for Importer); reason trimmed, 1-500 by `.length`, else 400 ValidationProblem `{ errors: { reason: [...] } }`; Imported -> Rejected with the reason, `lastChangedBy` / `lastChangedAt`; otherwise the same 409 shape as approve.
