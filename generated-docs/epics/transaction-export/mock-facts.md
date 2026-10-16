# Mock dataset facts — transaction-export

Test generators must treat the mock data and server below as **read-only**:
- `app-frontend/src/mocks/data/transactionExport.ts`: CSV builder, header, BOM, 409 messages, file-name builder, response headers, `createTransactionExport()`
- `app-frontend/e2e/fixtures/mock-backend.ts`: `GET /transactions/export`

The seeded transactions are listed in full in `../approve-and-reject/mock-facts.md`. The seeded files are in `../file-dashboard-and-details/mock-facts.md`.

There is **no MSW** in this project (`src/mocks/` holds data only). Vitest mocks `@/lib/api/client` (or the export endpoint function) and feeds it `createTransactionExport()` / `exportCsvOf()` / `nothingToExportBody()`.

## Isolation: the `mock-run` cookie

The export sees the run's changes: approve / reject decisions, rows loaded by a re-check, and cancelled files (their transactions drop out). Any spec that changes data and then exports must set:

```ts
context.addCookies([{ name: MOCK_RUN_COOKIE, value: mockRunValue(testInfo), url: baseURL }])
```

**Stale list (story 2 AC-2):** load Transactions filtered to Imported + april-batch-2 (6 rows), then approve those 6 through the mock with a direct request carrying the same `mock-run` cookie (`POST /transactions/{id}/approve`, ids for n = 3, 13, 15, 18, 25, 30). Export then answers 409 "No transactions match the current filters, so there is nothing to export." The list on screen still shows 6 until it reloads.

## Cookies

| Cookie | Value | Effect |
|---|---|---|
| `txn_session` | `mock-session-Approver` | may export |
| `txn_session` | `mock-session-Importer` | export answers 403 "You do not have access to this. Please ask your administrator for access." |
| `txn_session` | `mock-session-Approver-SessionExpired` (`endedSessionValue('Approver', 'SessionExpired')`) | export answers 401 `{ message, reason: SessionExpired }` (story 2 AC-4) |
| `mock-run` (`MOCK_RUN_COOKIE`) | `mockRunValue(testInfo)` | keeps decisions for this run |
| `mock-dataset` (`MOCK_DATASET_COOKIE`) | `empty` | no transactions: list `totalCount` 0, export with no filters answers 409 "There are no transactions yet, so there is nothing to export." |
| `mock-dataset` | `many` | same 30 transactions as seeded |

## Endpoint: GET `/transactions/export`

Checks, in order:
1. No active session: 401 (ended reason, else NotSignedIn).
2. Importer: 403 `forbiddenBody()`. Checked before the query.
3. Bad query value: 400 ValidationProblem, exactly as `GET /transactions`. `page` and `pageSize` are ignored, even invalid ones.
4. Nothing matches: 409 `{ message }` (see Messages).
5. Otherwise 200:
   - `Content-Type: text/csv; charset=utf-8`
   - `Content-Disposition: attachment; filename=<name>; filename*=UTF-8''<name>`
   - body `exportCsvOf(rows)`: same filters and order as the list, every page.

The `/api/[...path]` proxy passes `Content-Type` and `Content-Disposition` through unchanged and streams the body (it drops only `connection`, `content-encoding`, `content-length`, `keep-alive`, `transfer-encoding` and re-appends `set-cookie`). No production change was needed.

## File format

- **BOM:** the file starts with the bytes `EF BB BF` (`EXPORT_BOM` = `'﻿'`, `EXPORT_BOM_BYTES`). Read a Playwright download as a Buffer and check `buf.subarray(0, 3)`. `buf.toString('utf8')` keeps the BOM as its first character. A test that splits the text must strip it first.
- **Line endings:** every record ends with CR LF, including the last. `text.split('\r\n')` gives header + rows + one trailing `''`.
- **Header line** (`EXPORT_HEADER_LINE`, after the BOM):

  ```
  Reference,Transaction Date,Account Number,Description,Amount,Currency,Type,Status,File,Rejection Reason,Last Changed By,Last Changed On
  ```

- **Amount** is `toFixed(2)` with no separators (`9999.99`, `64000.00`).
- **Transaction Date** is `yyyy-MM-dd HH:mm:ss`.
- **Last Changed On** is in SAST, to the second.
- **Quoting:** RFC 4180.
- **Formula guard:** a leading `'` on text starting with `=`, `+`, `-`, `@`, TAB or CR. No seeded value triggers quoting or the guard.

First data rows with no filters (date descending):

```
TXN-20260430-0030,2026-04-30 07:30:00,1001-4410-0923,Insurance premium - SafeGuard,9999.99,ZAR,Debit,Imported,april-batch-2.csv,,System,2026-04-30 18:05:00
TXN-20260429-0029,2026-04-29 16:23:00,1001-2034-5567,Rental income - Unit 4B,830.65,ZAR,Credit,Approved,april-batch-1.csv,,Approver User,2026-05-03 10:30:00
```

First Rejected row (`status=Rejected`):

```
TXN-20260428-0028,2026-04-28 15:16:00,3003-1290-8814,Card settlement - Retail POS,64000.00,ZAR,Credit,Rejected,april-batch-2.csv,Account number does not match the beneficiary,Approver User,2026-05-02 10:30:00
```

## File names and row counts (seeded dataset)

`<date>` is today in SAST. Always build it with `exportDateOf()`; never hard-code it. The expected name for any filters is `exportFileName(filter, { exportDate: exportDateOf(), fileName })`. Sort never changes the name.

| Query | Rows | First → last reference | File name |
|---|---|---|---|
| (none) | 30 | 0030 → 0001 | `transactions_<date>.csv` |
| `status=Imported` | 15 | 0030 → 0001 | `transactions_Imported_<date>.csv` |
| `status=Imported&sortBy=Amount&sortDirection=Asc` | 15 | 0009 (45.00) → 0012 (22000.00) | `transactions_Imported_<date>.csv` |
| `status=Imported&fileId=<april-batch-1>` | 9 | 0027 → 0001 | `transactions_Imported_file-april-batch-1_<date>.csv` |
| `status=Imported&fileId=<april-batch-2>` | 6 | 0030 → 0003 | `transactions_Imported_file-april-batch-2_<date>.csv` |
| `status=Approved` | 10 | 0029 → 0002 | `transactions_Approved_<date>.csv` |
| `status=Rejected` | 5 | 0028 → 0004 | `transactions_Rejected_<date>.csv` |
| `fileId=<april-batch-2>` | 12 | 0030 → 0003 | `transactions_file-april-batch-2_<date>.csv` |
| `dateFrom=2026-04-01&dateTo=2026-04-10` | 10 | 0010 → 0001 | `transactions_from-2026-04-01-to-2026-04-10_<date>.csv` |
| `minAmount=1000` | 18 | 0030 → 0001 | `transactions_amount-from-1000_<date>.csv` |
| `maxAmount=100` | 4 | 0025 → 0004 | `transactions_amount-to-100_<date>.csv` |
| `minAmount=100&maxAmount=200.50` | 1 | 0020 | `transactions_amount-100-to-200.5_<date>.csv` |
| `search=0030` | 1 | 0030 | `transactions_search-0030_<date>.csv` |
| `status=Rejected&fileId=<april-batch-1>&dateFrom=2026-04-01&dateTo=2026-04-30&minAmount=100&search=TXN` | 1 | 0022 | `transactions_Rejected_file-april-batch-1_from-2026-04-01-to-2026-04-30_amount-from-100_search-TXN_<date>.csv` |
| `search=zzz` | — | — | 409 "No transactions match the current filters, so there is nothing to export." |
| (none), `mock-dataset=empty` | — | — | 409 "There are no transactions yet, so there is nothing to export." |

The file ids are `7c1e2a40-0000-4000-8000-000000000001` (april-batch-1) and `…000000000002` (april-batch-2), from `SEEDED_FILE_IDS`.

### Name rules

These match `ExportFileName.cs`:
- The date parts are a whole day as `yyyy-MM-dd`, otherwise `yyyy-MM-ddTHHmm[ss]`. For example `dateFrom=2026-04-20T00:00&dateTo=2026-04-25T12:30:15` gives `from-2026-04-20-to-2026-04-25T123015`.
- Amounts have no trailing zeros.
- The search is trimmed, and a blank search is no filter.
- File names and search text are made safe: each run of characters other than letters, digits, `-` and `.` becomes `-`, then `-` and `.` are trimmed from both ends, and the text is cut to 40 characters. When nothing is left, the part is just `file` or `search`.

## Messages

These are exported from `transactionExport.ts`:
- `NO_MATCHES_TO_EXPORT_MESSAGE`: "No transactions match the current filters, so there is nothing to export." Used when any filter is active.
- `NO_TRANSACTIONS_TO_EXPORT_MESSAGE`: "There are no transactions yet, so there is nothing to export." Used when no filter is active.
- `nothingToExportBody(hasActiveFilters)`: the 409 body `{ message }`.
- `hasActiveExportFilter(filter)`.
- `FALLBACK_EXPORT_FILE_NAME`: `transactions.csv`, the front-end's name when `Content-Disposition` is missing.
- `EXPORT_CONTENT_TYPE`, `EXPORT_COLUMNS`, `EXPORT_HEADER_LINE`, `EXPORT_BOM`, `EXPORT_BOM_BYTES`, `EXPORT_LINE_ENDING`.

Builders:
- `exportCsvOf(rows)`
- `exportRecordOf(t)`
- `exportFieldsOf(t)`
- `exportFileName(filter, { exportDate, fileName })`
- `exportDateOf(now?)`
- `exportNameFilterOf(query)`
- `exportResponseHeaders(fileName)`
- `safeExportText(text)`

Factory:
- `createTransactionExport({ fileName?, blob?, transactions? })` gives `{ fileName, blob }`. The default is the 15 seeded Imported rows as `transactions_Imported_2026-04-15.csv`.

## Events

The mock emits **no** SSE events. Specs stub `/api/events` with `page.route()`.

## Environment

Always run Playwright with `E2E_PROD=1` on port 3100. Port 3000 is a Docker container.
