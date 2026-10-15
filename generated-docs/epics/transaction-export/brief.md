# Epic: Exporting transactions

Inherits roles, auth, data source, compliance, and styling from project.md.

**Depends on:** `transactions-list` (the Transactions screen, its filters, sort, and `totalCount`).

## Goal

Approvers download a spreadsheet-ready file of exactly the transactions their current filters show. Importers never see the export option.

## Data Model

No new entities. This epic reads the existing Transaction shape through `GET /transactions/export` (see `app-backend/docs/TransactionApi.yaml`).

| Item | Notes |
|---|---|
| Export request | The same filter and sort query parameters as `GET /transactions`: `sortBy`, `sortDirection`, `status`, `fileId`, `dateFrom`, `dateTo`, `minAmount`, `maxAmount`, `search`. Paging parameters are not needed, since the export spans all pages. |
| Export response | A CSV attachment. The file name is in the `Content-Disposition` header and is built by the server. |
| No-match response | `409` when the filters match nothing. |
| List `totalCount` | Supplied by `GET /transactions`. When it is 0 the export action is unavailable. |

## Functional Requirements

- **R1 (TL-05):** An importer never sees **Approve**, **Reject**, or **Export**.
- **R2 (EX-01):** Export produces a `.csv` file of exactly the transactions that match the current filters, across all pages, not only the page on screen.
- **R3 (EX-02):** With no filters active, export includes every transaction.
- **R4 (EX-03):** The export has the same columns as the transactions list, plus the rejection reason, who last changed each transaction, and when.
- **R5 (EX-04):** The export's file name includes the export date and describes the active filters, for example `transactions_Imported_2026-04-15.csv`.
- **R6 (EX-05):** When the current filters match nothing, export is unavailable and the app explains why.
- **R7 (EX-06):** The export opens cleanly in a spreadsheet program.

## Business Rules

- **BR1:** Export is for approvers only (project.md roles). It is hidden, not disabled, for importers (AC-01). The back-end also enforces this (AC-03).
- **BR2:** This epic adds the last importer-hidden action. The importer ends up with no Approve, Reject, or Export anywhere (TL-05).
- **BR3:** The server builds the file and its name (EX-04). The front-end must keep the server's filename from `Content-Disposition` and must not invent its own.
- **BR4:** The export uses the filters and sort currently applied on the Transactions screen, passed to the server as the same query parameters as the list.
- **BR5:** The front-end disables export, with a visible explanation, when the list's `totalCount` is 0 (EX-05). It also handles a `409` from the export endpoint, in case the data changed after the list loaded, by showing that nothing matches.
- **BR6:** GN conventions apply: a label on any icon-only export button (GN-03), keyboard operability (GN-02), success messages that auto-dismiss and problems that persist (GN-05), and a usable layout on a narrow screen (GN-01).

## Key Workflows

1. Download with filters:
   1. The approver opens Transactions and applies filters (SF-01) and a sort.
   2. The approver selects **Export**.
   3. The front-end requests `GET /transactions/export` through the same-origin proxy with the current filters and sort.
   4. The browser downloads the CSV with the server's filename.
   5. A short success message appears and then disappears on its own.
2. Download with no filters: as above, with no filters active; every transaction is included.
3. Nothing to export:
   1. The filters match nothing, so `totalCount` is 0.
   2. **Export** is disabled and the screen explains that there is nothing to export for the current filters.
   3. If the export request still returns `409`, the app shows the same explanation and the problem stays until the filters change.
4. Importer: the importer opens Transactions and sees no Export action.

## Feature NFRs

- **NFR-1:** The download goes through a same-origin Next.js route or rewrite (project.md NFR-base-6). The browser never calls `:5100` directly, and the session cookie is forwarded.
- **NFR-2:** Export error states (network failure, 401, 403) follow the shared handling in project.md and offer a retry (NFR-base-5). A 401 returns the person to sign-in with the matching message.
- **NFR-3:** The proxy streams or passes the file through unchanged, preserving content type, `Content-Disposition`, and the character encoding, so the spreadsheet opens cleanly (EX-06).
- **NFR-4:** Account numbers and descriptions in the exported data must not be logged client-side (POPIA, project.md Compliance).

## Out of Scope

- Export in any format other than CSV.
- Choosing columns, or building the file in the browser.
- Exporting from the dashboard (file list) or from a file's detail screen.

## Notes & Caveats

- The planner notes put the file and its name on the server. Do not rebuild the CSV or the filename in the front-end.
- Both the disabled state at `totalCount` 0 and the `409` handling are needed. The list can go stale between load and click.
- If the list is stale or live updates change the data after the user clicks Export, the file reflects the server state at the time of the request.
