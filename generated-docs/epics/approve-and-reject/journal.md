# Journal — approve-and-reject

## Story 1 — Approve a transaction

Approve sits in a new Approver-only "Actions" column (and after "Details" on phone rows), only on Imported rows. The confirmation names the reference with Cancel focused; success swaps the row from the server's answer, toasts "<ref> approved." and reloads the view in place so a Status=Imported filter drops it. A 409 closes the dialog and shows a lasting problem ("It is now <Status>.", plus the reason when rejected); network/5xx keep the dialog open with "Try again". Surprise: a leading space inside an sr-only span is dropped from the accessible name in jsdom — fixed on the list's Details link too. The transactions-list epic's AC-6 list check (no Approve for Approvers) was trimmed to the details screen, since this epic requires those buttons.
