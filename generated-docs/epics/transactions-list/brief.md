# Epic Brief: Transactions list and search

Inherits roles, auth, data source, compliance, and styling from project.md.

Depends on: `sign-in-and-app-shell`.

## Goal

Both roles can browse, sort, page through and filter every transaction, and open one to see all its details, on a desktop and on a phone.

This epic replaces the approvers' placeholder landing page (Transactions) from the shell epic. It is view-only: Approve, Reject and Export belong to later epics, and nothing here shows them to anyone (AC-01, TL-05). The phone layout set here (GN-01) is the pattern every later list follows.

## Data Model

Source: `GET /transactions` and `GET /transactions/{transactionId}` in `app-backend/docs/TransactionApi.yaml` (authoritative; confirm exact property names there during BUILD).

**Transaction**
- Reference (unique across the app, case-insensitive)
- Transaction date and time (ISO local time, no offset)
- Account number
- Description (free text, can be empty)
- Amount (JSON number, exactly 2 decimals, never negative)
- Currency (ZAR)
- Transaction type: Credit or Debit
- Status: Imported, Approved or Rejected
- File: the file it came from (id and name)
- Rejection reason (present only on a rejected transaction)
- Last changed by (a person, or "System" when loaded)
- Last changed on (date and time)

**Transaction list response**: a page of transactions, paging info, and `hasAnyTransactions` (true when any transaction exists at all, ignoring filters).

**List query**: `page`, `pageSize` (5/10/20/50), `sortBy` (`TransactionDate`, `Reference`, `AccountNumber`, `Description`, `Amount`, `Currency`, `TransactionType`, `Status`, `FileName`), `sortDirection`, `status`, `fileId`, `dateFrom`, `dateTo`, `minAmount`, `maxAmount`, `search`.

## Functional Requirements

- **R1 (TL-01):** "Each transaction shows its reference, date and time, account, description, amount, currency, credit or debit, status, and the file it came from."
- **R2 (TL-02):** "The most recent transaction date appears first. The person can sort by any column, one at a time. The chosen sort stays in place while they move between pages."
- **R3 (TL-03):** "The list shows 20 transactions per page by default. The person can choose 5, 10, 20, or 50."
- **R4 (TL-06):** "Opening a transaction shows all its details. A rejected transaction shows its rejection reason, which cannot be edited."
- **R5 (TL-08):** "When there are no transactions at all, the list says "No transactions yet"."
- **R6 (SF-01):** "The person can filter by status, by file, by a range of transaction dates, by a range of amounts, and by text that matches the reference or the account number."
- **R7 (SF-02):** "Filters combine. A transaction must match every active filter to appear."
- **R8 (SF-03):** "Each active filter is shown on screen, and one action clears them all."
- **R9 (SF-04):** "When filters match nothing, the list says no transactions match, shows the active filters, and offers to clear them."
- **R10 (TS-01):** "Every loaded transaction starts as **Imported**." In this epic: newly loaded transactions appear in the list with the status Imported, shown in words (FS-03).
- **R11 (FP-08):** "The app records "System" as the person who created each loaded transaction." In this epic: transaction details show "System" as Last changed by for a transaction that has not been changed since it was loaded.
- **R12 (GN-01):** "The app works on a phone as well as on a desktop. On a narrow screen, lists show the key details of each row and keep its actions available." In this epic: the transactions list is the first list built to this pattern. On a narrow screen each row shows its key details (at least reference, date, amount with credit/debit, status) and keeps opening its details available, in a form that later epics can add Approve/Reject to without redesign.

## Business Rules

- **BR1:** The list defaults to sort by transaction date, newest first, page 1, 20 per page.
- **BR2:** The URL carries the list state (status, fileId, other filters, sort, page, page size) so links can open a pre-filtered list. The list must accept `status` and `fileId` from the URL, because the dashboard (DB-01) and file details (FD-02) link into it. Using the Back button or reloading restores the same view.
- **BR3:** Changing a filter, or the page size, returns to page 1. Changing the sort keeps the filters.
- **BR4:** Distinguish the two empty states using `hasAnyTransactions`: false gives "No transactions yet" (TL-08); true with zero matches gives the no-match state with active filters and a clear-all action (SF-04). Never show both.
- **BR5:** Status is always shown as words, never by colour alone (FS-03).
- **BR6:** Both Importer and Approver see the same list, filters and details. No Approve, Reject or Export controls appear for anyone in this epic (AC-01, TL-05).
- **BR7:** Amounts display with 2 decimals and the currency; dates display as local date and time without timezone conversion (the API returns ISO local times with no offset).
- **BR8:** Account numbers and descriptions must never be written to client-side logs, analytics, or error-reporting payloads (POPIA, project.md Compliance).
- **BR9:** Inherit the shell's GN-02 to GN-05 conventions: everything operable by keyboard alone, labelled tooltips on icon-only buttons, fields checked on leaving the field and on submit rather than on every keystroke, success messages auto-dismiss while problems stay until resolved.
- **BR10:** The amount range must reject a minimum above the maximum with a message on the field, and the date range a start after the end, instead of silently returning nothing.

## Key Workflows

1. **Approver lands on Transactions (SI-05):** sign in, see the list newest first with 20 per page, scan rows, sort a column, page forward (sort stays), change page size.
2. **Find a transaction:** open filters, set status and/or file, a date range, an amount range, and search text on reference or account number; the list narrows, each active filter shows as a removable chip, and one action clears all.
3. **No match:** filters match nothing, the list says no transactions match, shows the active filters and offers to clear them.
4. **Arrive from a link:** from the dashboard count or file details count, the list opens already filtered by status and/or file, with those filters shown as active.
5. **Open details:** select a row to see all its details, including file, last changed by ("System" when freshly loaded), last changed on, and the rejection reason when rejected (read-only). Return to the list with the same view.
6. **Phone:** on a narrow screen the same flows work with a compact row layout and the filters reachable without horizontal scrolling.
7. **Stays current:** while the list is open, a `transactions-changed` event from the shell's `/events` connection refreshes the list in place, keeping filters, sort and page; a `resync` also refetches.
8. **Empty app:** with no transactions at all, the list says "No transactions yet".

## Feature NFRs

- **NFR-1:** The list and filter controls are fully keyboard operable, and every icon-only button has a tooltip label (GN-02, GN-03).
- **NFR-2:** Loading, error (with retry) and empty states exist for the list and the details (NFR-base-5).
- **NFR-3:** The list works at 360px wide without horizontal page scroll (NFR-base-3).
- **NFR-4:** Text filters are not applied on every keystroke against the API in a way that floods it: apply on submit or after a short pause.
- **NFR-5:** Use the shell's single `/events` connection. Do not open a second one.

## Out of Scope

- Approve, Reject and their confirmation dialogs (AP-, RJ-): later epic.
- Export to CSV (EX-): later epic.
- The "Imported" count badge on the Transactions menu (TL-07): later epic.
- Dashboard and file details screens themselves (DB-, FD-); this epic only accepts the filters they link in with.

## Notes & Caveats

- The project has no design source, so the layout is the epic's choice within the template's Shadcn components and tokens.
- The approvers' placeholder Transactions page from the shell epic is replaced, not wrapped.
- The browser must call the API through same-origin Next.js rewrites or route handlers, never `:5100` directly.
