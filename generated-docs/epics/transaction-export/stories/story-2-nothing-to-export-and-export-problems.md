# Story 2: Nothing to export, and export problems

- **Epic:** transaction-export
- **Slug:** story-2-nothing-to-export-and-export-problems
- **Roles:** Approver
- **Route:** /transactions
- **Page action:** modify_existing
- **Infrastructure only:** false
- **Requirement IDs:** R6, BR5, BR6, GN-01, GN-02, GN-05, NFR-2, NFR-4
- **Target file:** app-frontend/src/components/transactions/TransactionsList.tsx

## Plain summary

When the current filters match no transactions, Export is unavailable and the screen says why, right next to it. If the data changes after the list loaded and the export finds nothing, the Approver is told the same thing and the message stays until the filters change. If the export fails for another reason, such as a lost connection, the Approver sees what went wrong and can try again; an ended session goes back to sign-in. Export stays usable on a phone.

## Technical summary

- **Nothing to export (R6, BR5).** When the loaded `result.totalCount === 0`, Export is unavailable: `aria-disabled="true"` (kept focusable so a keyboard user can reach it and hear why), click does nothing, and a visible note beside it, linked by `aria-describedby`. Wording mirrors the back-end's 409 messages: with active filters "No transactions match the current filters, so there is nothing to export."; with none "There are no transactions yet, so there is nothing to export." Before the first load, Export is unavailable without the note. During an "Updating…" reload the state follows the last loaded result.
- **409 from the export (BR5).** No download; show the response `message` verbatim in an inline `role=alert` beside Export (same place as the note) and keep Export unavailable until the view's filters change (cleared on any change of the filters in the URL). A sort-only change does not clear it.
- **Other failures (NFR-2).** Network / 502-504 (`isNetworkError`), 5xx and any other status: inline `role=alert` beside Export, "The export could not be downloaded." plus "Try again", which repeats the same request with the same query; 403 shows the server's `message`; 400 shows "The current filters could not be used for the export." with the `errors` values. The problem stays until Try again succeeds, the filters change, or a new export starts (GN-05). 401: the central client handler leaves for sign-in with the reason; return early on `isRedirectingToSignIn` (no message, no retry).
- **Phone (GN-01).** At 360px the Export row (button + note / problem) wraps within the width, no sideways scrolling; button full width below md.
- **Privacy (NFR-4).** Messages carry only the server's message or fixed wording; no transaction data or bodies logged.

## Acceptance criteria

- **AC-1** (coverage: vitest): When the current filters match no transactions, Export is unavailable and a visible note beside it explains there is nothing to export for the current filters (or that there are no transactions yet when no filters are set); once the filters match transactions again, Export is available.
- **AC-2** (coverage: playwright): If the list showed matches but the export finds nothing by the time it runs, no file downloads, the server's explanation shows beside Export, and it stays until the filters change.
- **AC-3** (coverage: vitest): If the export fails because the connection or server fails, a problem message with "Try again" appears beside Export, and Try again repeats the same export; a refusal shows the server's message.
- **AC-4** (coverage: playwright): If the session has ended when Export is selected, the Approver is taken to the sign-in screen with the matching explanation and no problem message is left behind.
- **AC-5** (coverage: playwright): At phone width (360px), Export and its note or problem message are reachable and readable without sideways scrolling, and exporting works the same way.

Additional technical checks (3):
- An unavailable Export sends no request.
- Try again sends the same `GET /transactions/export` query as the failed attempt.
- A sort-only change does not clear the nothing-matches message; a filter change does.

## Manual test checklist

- As the Approver, filter Transactions so nothing matches (e.g. a search for text no reference contains) → Export is greyed out and the note says no transactions match the current filters, so there is nothing to export.
- Clear the search → Export is available again.
- Filter to the Imported transactions of one file, then (in another tab) approve them all, and select Export in the first tab without refreshing → no file downloads and the message says nothing matches; it stays until you change a filter.
- Stop the back-end and select Export → a problem message with "Try again" appears; start the back-end and select Try again → the file downloads.
- Narrow the browser to phone width → Export and its note fit on screen without sideways scrolling, and exporting works.

## Resolved design choices (defaults chosen; stories approval delegated)

- The "nothing to export" note sits right beside Export (not in a pop-up), uses the same wording as the server, and the button stays focusable so keyboard and screen-reader users learn why it is unavailable.
- Problems with the export show inline beside Export rather than as a pop-up message, so "Try again" sits next to the button it repeats; they stay until resolved or the filters change.
- A "nothing matches" answer from the server keeps Export unavailable until a filter changes; changing only the sort does not clear it, because the same transactions would still match.
- An ended session goes back to sign-in through the app's usual handling; no extra message is shown on Transactions.

## Infrastructure reuse notes

- **List result.** `TransactionsList`'s loaded `result.totalCount`, `hasActiveFilters(view.filters)` (`lib/transactions/activeFilters.ts`).
- **Errors.** `statusOf`, `isNetworkError`, `isRedirectingToSignIn`, `isAPIError` (`lib/api/errors.ts`); 409 `{message}` and 403 `{message}` on `APIError.message` / `body`; 400 `errors`.
- **Inline problem pattern.** As the dialogs' inline `role=alert` + "Try again" (e.g. `ApproveTransactionDialog`, `CancelFileDialog`).
- **Sign-in.** Central 401 handler in `lib/api/client.ts` and `SignInReasonNotice` on the sign-in screen.
- **E2E mock.** Story 1's `GET /transactions/export` mock handler. AC-2 creates the stale case by approving the matching Imported transactions through the mock (same `mock-run`) after the list has loaded; AC-4 ends the session via the mock's existing sign-out / session-ended handling before selecting Export; network failure in Vitest via an MSW `HttpResponse.error()` / 503 override.
