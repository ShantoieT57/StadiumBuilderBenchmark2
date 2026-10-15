# Story 3: Transaction details

- **Epic:** transactions-list
- **Slug:** story-3-transaction-details
- **Roles:** Importer, Approver
- **Route:** /transactions/[transactionId]
- **Page action:** create_new
- **Infrastructure only:** false
- **Requirement IDs:** R4, R10, R11, BR5, BR6, BR7, BR8, BR9, NFR-1, NFR-2
- **Target file:** app-frontend/src/app/(authenticated)/transactions/[transactionId]/page.tsx

## Plain summary

Selecting a transaction opens a page with all its details, including the file it came from, who last changed it ("System" when freshly loaded), when, and the read-only rejection reason for a rejected transaction. Going back returns to the list exactly as it was. Nobody sees Approve, Reject or Export yet.

## Technical summary

- **New route.** `(authenticated)/transactions/[transactionId]/page.tsx`, wrapped in `RouteGuard route="/transactions"`. No new access-map row is needed.
- **Fields.** Load `getTransaction(id)` and show every TransactionDetails field, using the same amount, date and status formatters as story 1.
- **Rejection reason.** Shown read-only, and only when the status is Rejected.
- **Last changed by.** `lastChangedBy` is shown verbatim ("System" for loaded rows).
- **States.** Loading, an error with Retry, and not found (404 "Transaction not found").
- **Returning to the list.** The list's row link carries the list's query string, or uses history back, so returning restores filters, sort and page.
- **No actions yet.** No Approve, Reject or Export controls render on the list or the details, for either role (BR6).

## Acceptance criteria

- **AC-1** (coverage: playwright): Selecting a transaction in the list (by mouse or keyboard) opens its details showing every field, including the file it came from, last changed by and last changed on.
- **AC-2** (coverage: vitest): A rejected transaction shows its rejection reason as read-only text, and a transaction that is not rejected shows no rejection reason.
- **AC-3** (coverage: vitest): A freshly loaded transaction shows status Imported and "System" as last changed by.
- **AC-4** (coverage: playwright): Returning from details to the list restores the same filters, sort, page and page size.
- **AC-5** (coverage: vitest): The details page shows a loading state, a problem with Retry when loading fails, and a not-found message for an unknown transaction.
- **AC-6** (coverage: vitest): Neither an Importer nor an Approver sees Approve, Reject or Export controls on the list or the details.

Additional technical checks (1): `lastChangedOn` is shown in a clear local format.

## Manual test checklist

- Click a transaction in the list → you see all its details, including the file name, last changed by and last changed on.
- Open a newly loaded transaction → status is Imported and last changed by is "System".
- Open a rejected transaction → you see its rejection reason and cannot edit it.
- Filter and sort the list, open a transaction, then go back → the list is exactly as you left it.
- As both the Importer and the Approver → there is no Approve, Reject or Export button anywhere on the list or details.

## Back-end behaviour already verified

- **TransactionDetails fields:** id, reference, transactionDate, accountNumber, description, amount, currency, transactionType, status, file {id, fileName}, createdBy, createdAt, lastChangedBy, lastChangedAt, rejectionReason.
  - `createdAt` and `lastChangedAt` are ISO times with an offset.
  - `rejectionReason` is null unless the status is Rejected.
- **Unknown id:** 404 `{message:"Transaction not found"}`.
- **Cancelled file:** a transaction from a cancelled file is also 404.

## Infrastructure reuse notes

See story 1: the shared formatters module, the error handling conventions, and the mock-backend fixtures for GET /transactions/{id}.
