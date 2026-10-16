# Story 1: Export the filtered transactions

- **Epic:** transaction-export
- **Slug:** story-1-export-the-filtered-transactions
- **Roles:** Approver, Importer
- **Route:** /transactions
- **Page action:** modify_existing
- **Infrastructure only:** false
- **Requirement IDs:** R1, R2, R3, R4, R5, R7, BR1, BR2, BR3, BR4, BR6, GN-02, GN-03, GN-05, NFR-1, NFR-3, NFR-4
- **Target file:** app-frontend/src/components/transactions/TransactionsList.tsx

## Plain summary

On the Transactions screen, an Approver has an Export button that downloads a spreadsheet file of exactly the transactions the current filters show, across all pages, in the current sort order, under a name that says what was exported and when (for example `transactions_Imported_2026-04-15.csv`). With no filters, every transaction is included. A short message confirms the download and then goes away. Importers never see Export.

## Technical summary

- **Endpoint function.** New `exportTransactions(query: ExportTransactionsQuery)` in `lib/api/endpoints.ts` returning `{ blob: Blob, fileName: string }`. The binary path of `apiClient` returns only the Blob, so the endpoint needs the response headers: extend the client with an opt-in that also returns the `Response` headers (e.g. a `withResponseHeaders` / `rawResponse` option) or build it in `lib/api/` from `fetch` + `apiErrorFromResponse` / `createNetworkError` so it throws the same `APIError` (central 401 handling included). Never `fetch` from a component (Critical Rule 2).
- **Server file name (BR3, R5).** Parse `Content-Disposition` in a small helper (e.g. `lib/api/contentDisposition.ts`, `fileNameFromContentDisposition`): prefer `filename*` (RFC 5987, `UTF-8''` percent-decoded), else `filename` (quoted or bare). Never compose a name from the filters. Fallback only when the header is missing or unreadable: `transactions.csv`.
- **Query (BR4, R2, R3).** Build from the list's current view: `toTransactionsQuery(view)` minus `page` / `pageSize` (the export spans all pages). Same API names and values, defaults omitted, so no filters -> no filter params.
- **Button (R1, BR1, BR2).** `TransactionsList` already receives `role`. For `role === 'Approver'` only, render an "Export" button (shadcn Button, outline, with a download icon and the visible word "Export", so not icon-only and no tooltip, GN-03) in a toolbar row at the top of the list area, right-aligned on md+ and full width below md. Hidden, never disabled, for Importers; Importers never call the export endpoint.
- **Download (NFR-3).** On 200 save the Blob through a temporary object URL + `<a download={fileName}>` (as `FileDetailsView`'s `saveBlob`; lift it to a shared helper such as `lib/download/saveBlob.ts` rather than copying), revoke the URL afterwards. The Blob is passed through unchanged (no re-encoding, BOM kept); the CSV is never read, parsed or logged (NFR-4).
- **Progress and success (GN-05).** While the request is in flight the button shows "Exporting…" and is locked so it can't be started twice. On success a `success` toast "Export downloaded" with the file name as its message (auto-dismisses).
- **Proxy (NFR-1).** `BACKEND_ENDPOINTS` already allowlists `GET /transactions/export`; the `/api/*` proxy streams the body and passes `Content-Type` and `Content-Disposition` through. Verify; change only if a header is dropped.
- **Story 2 hand-off.** The disabled-at-zero state, the 409 message and the failure + retry handling are story 2; this story leaves a single place (the export action's catch path) for them and returns early on `isRedirectingToSignIn`.

## Acceptance criteria

- **AC-1** (coverage: vitest): An Approver sees an Export button on the Transactions screen; an Importer sees no Export (and still no Approve or Reject) anywhere on it.
- **AC-2** (coverage: playwright): With filters and a sort applied, selecting Export using only the keyboard downloads a `.csv` file named by the server for those filters (e.g. `transactions_Imported_<date>.csv`) holding exactly the matching transactions from every page, in the list's order.
- **AC-3** (coverage: playwright): With no filters active, Export downloads every transaction in a file named `transactions_<date>.csv`.
- **AC-4** (coverage: playwright): The downloaded file has a header row with the list's columns plus Rejection Reason, Last Changed By and Last Changed On, and arrives byte-for-byte as the server sent it (UTF-8 with its byte-order mark), so it opens cleanly in a spreadsheet.
- **AC-5** (coverage: vitest): While the export is downloading, Export shows progress and cannot be started a second time; when the file arrives a success message naming the file appears and closes on its own.

Additional technical checks (3):
- The request is one `GET /transactions/export` through the same-origin `/api`, with the list's filter and sort parameters and no `page` / `pageSize`.
- The file name comes from `Content-Disposition` (`filename*` preferred over `filename`), never built in the browser.
- No account numbers, descriptions or file contents are logged.

## Manual test checklist

- Sign in as the Approver and open Transactions → an Export button sits above the list.
- Set Status to Imported, sort by Amount, then select Export → a file such as `transactions_Imported_<today>.csv` downloads and a success message naming it fades after a few seconds.
- Open that file in Excel (or another spreadsheet) → it opens cleanly with the list's columns plus Rejection Reason, Last Changed By and Last Changed On, only Imported rows, sorted by amount, including rows from beyond the first page.
- Clear all filters and select Export → the file is named `transactions_<today>.csv` and has every transaction.
- Tab to Export and press Enter → the download works from the keyboard.
- Sign in as the Importer → there is no Export button on Transactions.

## Resolved design choices (defaults chosen; stories approval delegated)

- Export is a text button with a download icon labelled "Export", at the top of the list area (right-aligned on wide screens, full width on phones); not icon-only, so no hover label is needed.
- The download keeps exactly the name the server sends; if the name is ever missing, the file is saved as `transactions.csv`.
- The file is fetched in the page and then saved (rather than a plain link) so the app can show progress, the success message and story 2's problems instead of a broken download.
- The success message is "Export downloaded" with the file name, and closes on its own.
- The export uses the filters and sort currently applied; page and rows-per-page are not sent.

## Infrastructure reuse notes

- **List state.** `useListQuery` / `toTransactionsQuery` (`lib/transactions/listQuery.ts`) for the current view; `TransactionsList` already has `role` and the loaded `result`.
- **Types.** `ExportTransactionsQuery` (= `TransactionFilterQuery`) in `src/types/api-generated.ts`.
- **Download pattern.** `FileDetailsView`'s `DownloadOriginal` / `saveBlob` (Blob via temporary object URL + `<a download>`, success / problem toast); lift `saveBlob` to a shared helper and use it from both.
- **Client / errors.** `apiClient` (`isBinaryResponse`), `apiErrorFromResponse` / `createNetworkError`, `isRedirectingToSignIn`, `statusOf`, `isNetworkError`.
- **Proxy.** `/api/[...path]` route + `BACKEND_ENDPOINTS` (export row present).
- **Feedback.** `useToast()` success.
- **E2E mock.** Extend `app-frontend/e2e/fixtures/mock-backend.ts` with `GET /transactions/export` with real semantics, scoped by the `mock-run` cookie: Approver only (403 `{message}` for Importer); reuse `listTransactions`' filtering and sorting over the run's dataset without paging; CSV per the contract (BOM, CR LF, RFC 4180 quoting, columns and formats, formula-injection apostrophe); `Content-Type: text/csv; charset=utf-8`; `Content-Disposition` with `filename` + `filename*` built per the contract's naming rules (reuse `contentDispositionFor`); 409 `{message}` with the contract's two messages when nothing matches; 400 for invalid queries as the list does. Add a matching MSW handler for Vitest under `src/mocks/`.
