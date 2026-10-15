# Story 1: Transactions list with sorting, paging and phone layout

- **Epic:** transactions-list
- **Slug:** story-1-transactions-list
- **Roles:** Importer, Approver
- **Route:** /transactions
- **Page action:** modify_existing
- **Infrastructure only:** false
- **Requirement IDs:** R1, R2, R3, R5, R10, R12, BR1, BR2, BR5, BR7, BR8, BR9, NFR-1, NFR-2, NFR-3, NFR-5
- **Target file:** app-frontend/src/app/(authenticated)/transactions/page.tsx

## Plain summary

Importers and Approvers open Transactions and see every transaction, newest first, 20 per page. They can sort by any column, move between pages, choose 5, 10, 20 or 50 per page, and use the same list on a phone. The list refreshes by itself when transactions change.

## Technical summary

- **Page.** Replace the placeholder `(authenticated)/transactions/page.tsx`. Keep it wrapped in `RouteGuard route="/transactions"`. It becomes a client list that calls `getTransactions`.
- **URL state.** `sortBy`, `sortDirection`, `page` and `pageSize` live in the URL search params. The defaults (TransactionDate desc, page 1, size 20) are omitted from the URL.
  - Sorting keeps the current page params.
  - Changing the page size resets to page 1.
- **Layout.**
  - Desktop shows a table.
  - Narrow screens show compact rows: reference, date, amount with Credit/Debit, and status in words.
  - Each row has an "open details" link slot that later epics can extend with Approve and Reject.
- **Formatting.**
  - Amounts show 2 decimals plus the currency.
  - `transactionDate` is shown as sent, with no timezone conversion.
- **States.** Loading, an error with Retry, and "No transactions yet" (when `hasAnyTransactions` is false).
- **Live refresh.** Subscribe via `useEvents()` to `transactions-changed` and `resync`, and refetch in place with the current params.
- **Privacy.** Account numbers and descriptions never go to the console or into error payloads.

## Acceptance criteria

- **AC-1** (coverage: vitest): Each row shows reference, date and time (as sent, no timezone shift), account, description, amount with 2 decimals and currency, Credit or Debit, status in words, and file name.
- **AC-2** (coverage: playwright): The list opens newest first. Choosing a column header sorts by that column (one at a time, direction toggles), and the chosen sort stays while paging forward and back. Reload and the browser Back button restore the same sort and page.
- **AC-3** (coverage: playwright): The list shows 20 per page by default. Choosing 5, 10, 20 or 50 changes the page size and returns to page 1.
- **AC-4** (coverage: vitest): While loading, the list shows a loading state. A failed load shows a problem with a Retry action. When no transactions exist at all, it says "No transactions yet".
- **AC-5** (coverage: playwright): At 360px wide each row shows reference, date, amount with Credit/Debit and status, details stay reachable, and the page has no horizontal scroll.
- **AC-6** (coverage: vitest): When a transactions-changed or resync update arrives, the list refreshes in place and keeps its sort, page and page size.

Additional technical checks (2):
- No account numbers or descriptions are logged (BR8).
- One shared live connection only, with no new EventSource (NFR-5).

## Manual test checklist

- Sign in as the Approver → you land on Transactions and see the newest transaction at the top, 20 rows per page.
- Click the Amount column heading, then go to page 2 → the list is still sorted by Amount.
- Reload the page, then press Back → you see the same sort and page you left.
- Change "per page" to 5 → you see 5 rows and you are back on page 1.
- Check a row → the amount has 2 decimals and ZAR, and the status reads Imported, Approved or Rejected in words.
- Narrow the browser to phone width (about 360px) → each transaction shows as a compact row with reference, date, amount, Credit/Debit and status, and there is no sideways scrolling.
- Sign in as the Importer and open Transactions from the menu → you see the same list.

## Resolved design choices (approved at the stories approval)

- Filters, sort and page live in the address bar, so links, reload and Back all keep the view.
- Desktop shows a table and phones show compact rows.

## Back-end behaviour already verified (backend cycle 9, live)

- `dateFrom` / `dateTo` accept `yyyy-MM-dd`, meaning the whole day (inclusive), or a local `yyyy-MM-ddTHH:mm` with **no** offset. A `Z` or an offset is refused with 400. Send plain dates.
- `search` matches reference OR account number, ignoring case, as a literal substring.
- `transactionDate` is a local ISO time without an offset. Display it as-is.
- `amount` is a JSON number with exactly 2 decimals.
- The response includes `hasAnyTransactions`, which is unfiltered.
- `sortBy` takes TransactionDate, Reference, AccountNumber, Description, Amount, Currency, TransactionType, Status or FileName. Default is TransactionDate desc; other columns default to asc.
- Page sizes are 5, 10, 20 or 50.

## Infrastructure reuse notes

- **API calls.** Use `getTransactions` and `getTransaction` (and `getFiles` for the file filter options) from `app-frontend/src/lib/api/endpoints.ts`, with `ListTransactionsQuery`, `TransactionPage` and `TransactionDetails` from `src/types/api-generated.ts`. Don't add new wrappers.
- **Proxy.** The allowlist (`src/lib/server/backendEndpoints.ts`) already covers GET /transactions, GET /transactions/{id} and GET /files.
- **Access.** Keep `RouteGuard route="/transactions"`. `ROUTE_ACCESS` already grants both roles. Pages render no `<main>` of their own.
- **Live refresh.** Use `useEvents().subscribe('transactions-changed' | 'resync')` from `src/contexts/EventsContext.tsx`. Never open another EventSource (NFR-5).
- **Errors.**
  - Return early when `isRedirectingToSignIn(error)`.
  - Use `isNetworkError` for the unreachable wording.
  - Screens add no 401 handling of their own.
  - Problems with a retry go inline. Non-field feedback goes through `useToast()`.
- **Status styling.** Status wording and colour use the success, warning and destructive tokens, and the status is always shown in words (BR5). No palette utilities or hex values (styling-centralisation).
- **Icon-only buttons.** Each needs an aria-label plus a shadcn Tooltip with its own `TooltipProvider disableHoverableContent`.
- **shadcn primitives.** Present: alert, button, card, input, label, sheet, tooltip. Expect to add table, select and badge (and possibly pagination) via `(cd app-frontend && npx shadcn add <c> --yes)`.
  - Upstream new-york-v4 sources may inject `import { cn } from "cn"`. Rewrite it to `@/lib/utils` and make sure `cn` is not left in package.json (see `generated-docs/template-feedback.md`).
- **Shared formatters.** Put the amount, date and status formatters in a shared module (e.g. `src/lib/format/transaction.ts`) for stories 1 and 3 and the later epics.
- **E2E mock.** Extend `app-frontend/e2e/fixtures/mock-backend.ts` with GET /transactions (paging, sort, filters, `hasAnyTransactions`), GET /transactions/{id} and GET /files fixtures. Browser /api calls pass through the Next proxy to this Node mock.
