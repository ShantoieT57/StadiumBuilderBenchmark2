# Journal — approve-and-reject

## Story 1 — Approve a transaction

Approve sits in a new Approver-only "Actions" column (and after "Details" on phone rows), only on Imported rows. The confirmation names the reference with Cancel focused; success swaps the row from the server's answer, toasts "<ref> approved." and reloads the view in place so a Status=Imported filter drops it. A 409 closes the dialog and shows a lasting problem ("It is now <Status>.", plus the reason when rejected); network/5xx keep the dialog open with "Try again". Surprise: a leading space inside an sr-only span is dropped from the accessible name in jsdom — fixed on the list's Details link too. The transactions-list epic's AC-6 list check (no Approve for Approvers) was trimmed to the details screen, since this epic requires those buttons.

## Story 2 — Reject with a reason

Reject opens "Reject <reference>?" with a required Reason, a polite live counter of characters left out of 500 (trimmed, counted like the server so an emoji is two), and Reject disabled until a real reason is typed. Over-long pastes are never truncated — the counter says how many too many and the field refuses on blur/submit. Success toasts "<reference> rejected." and marks the row Rejected; a 409 reuses story 1's lasting message; a server refusal of `reason` shows under the field; other failures keep the typed reason with "Try again" (a non-reason 400 shows inline without retry). The shadcn CLI again wrote `import { cn } from "cn"` — fixed with the logged workaround.
