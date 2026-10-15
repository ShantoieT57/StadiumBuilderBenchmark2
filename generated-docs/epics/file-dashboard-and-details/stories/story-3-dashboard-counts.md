# Story 3: Dashboard status and transaction counts

- **Epic:** file-dashboard-and-details
- **Slug:** story-3-dashboard-counts
- **Roles:** Importer, Approver
- **Route:** /dashboard
- **Page action:** modify_existing
- **Infrastructure only:** false
- **Requirement IDs:** R1, BR1, BR2, BR4, NFR-1, NFR-2, NFR-3, NFR-5
- **Target file:** app-frontend/src/app/(authenticated)/dashboard/page.tsx

## Plain summary

Above the file list, the Dashboard shows how many files are Uploaded, Processing, Completed and Failed, and how many transactions are Imported, Approved and Rejected across all files that are not cancelled. Selecting a file count filters the list to that status; selecting a transaction count opens the Transactions list filtered to that status. The counts update by themselves.

## Technical summary

- **Summary strip.** New `components/files/DashboardSummary.tsx` above the list, calling `getDashboardSummary`. Two labelled groups: "Files" (Uploaded, Processing, Completed, Failed) and "Transactions" (Imported, Approved, Rejected), each a number with its status in words.
- **File-status counts.** Each is a link to the Dashboard with `status=<Status>` set via story 1's `withFilters` (other filters and the sort kept, page reset to 1), so the filter form and chips from story 2 reflect it.
- **Transaction counts.** Each is a link to `/transactions?status=<Imported|Approved|Rejected>` (the transactions list already reads `status` from the URL).
- **States.** Loading placeholder, and a problem with Retry for the counts that does not block the list (and vice versa).
- **Live refresh.** `useEvents().subscribe('file-changed' | 'transactions-changed' | 'resync')` -> refetch the summary in place.
- **Layout.** A wrapping grid that stays reachable at 360px (no horizontal scroll); counts are real links, so they work by keyboard.
- Counts are shown exactly as the back-end returns them; the "not cancelled" rule (BR1) is the back-end's.

## Acceptance criteria

- **AC-1** (coverage: vitest): Above the list the Dashboard shows the number of files in each status (Uploaded, Processing, Completed, Failed) and the number of Imported, Approved and Rejected transactions, each labelled in words.
- **AC-2** (coverage: playwright): Selecting a file-status count filters the list to that status, shows it as the active status filter, and returns to page 1.
- **AC-3** (coverage: playwright): Selecting the Imported, Approved or Rejected count opens the Transactions list filtered to that status.
- **AC-4** (coverage: vitest): While loading the counts show a loading state, and a failed load shows a problem with Retry while the file list still works.
- **AC-5** (coverage: vitest): When a file-changed, transactions-changed or resync update arrives, the counts refresh in place.
- **AC-6** (coverage: playwright): At 360px every count is visible without sideways scrolling and each can be reached and selected by keyboard alone.

Additional technical checks (1):
- One shared live connection only, no new EventSource (NFR-1).

## Manual test checklist

- Open the Dashboard → above the list you see file counts for Uploaded, Processing, Completed and Failed, and transaction counts for Imported, Approved and Rejected.
- With the seeded data → Completed shows at least 1 and Imported shows at least 20.
- Click the Completed count → the list shows only Completed files and the status filter reads Completed.
- Click the Imported count → you land on Transactions showing only Imported transactions.
- Using only Tab and Enter, reach the Rejected count and select it → you land on Transactions filtered to Rejected.
- At phone width → all counts are visible above the list without sideways scrolling.

## Resolved design choices (defaults chosen; stories approval delegated)

- Counts are plain links (number plus status word), grouped under "Files" and "Transactions" headings.
- A count of zero is still selectable (it leads to an empty, filtered list) so the layout never shifts.
- Selecting a file-status count keeps the other filters and the sort and replaces only the status filter.

## Infrastructure reuse notes

- **API calls.** `getDashboardSummary` from `app-frontend/src/lib/api/endpoints.ts` with `DashboardSummary` from `src/types/api-generated.ts`; proxy already allows GET /dashboard/summary.
- **Links.** Transactions list URL state lives in `lib/transactions/listQuery.ts` (`toListSearch`); build the `/transactions?status=` href with it rather than by hand. File-list status links use story 1's `lib/files/listQuery.ts`.
- **Status words.** Reuse `formatTransactionStatus` for the transaction counts and story 1's file status wording for the file counts.
- **Live refresh / errors.** As story 1 (`useEvents().subscribe`, `isRedirectingToSignIn`, `isNetworkError`).
- **E2E mock.** Add GET /dashboard/summary to `app-frontend/e2e/fixtures/mock-backend.ts`, computed from the seeded files and transactions (non-cancelled only), so it agrees with the lists.
