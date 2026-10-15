# Mock dataset facts — file-dashboard-and-details

These are the shared facts for test generators and developers.

The sources are:
- `app-frontend/src/mocks/data/files.ts`
- `app-frontend/src/mocks/data/dashboardSummary.ts`
- `app-frontend/e2e/fixtures/mock-backend.ts`

All of them are read-only for test generators.

## Seeded files (`DASHBOARD_FILE_IDS`)

- Ids are `7c1e2a40-0000-4000-8000-0000000000NN`.
- All times are at the +02:00 offset.
- "Imp" is the Imported/Approved/Rejected transaction count.

| NN | key | name | status | cancelled | lastProcessedAt | rows | Imp | loaded/skipped/ignored | history |
|---|---|---|---|---|---|---|---|---|---|
| 01 | aprilBatch1 | april-batch-1.csv | Completed | no | 04-30 18:05 | 18 | 9/6/3 | 18/0/0 | 6 stages |
| 02 | aprilBatch2 | april-batch-2.csv | Completed | no | 04-30 18:20 | 12 | 6/4/2 | 12/0/0 | 6 stages |
| 03 | allSkipped | march-statement-rerun.csv | Completed | no | 04-27 09:12 | 8 | 0/0/0, fully reviewed | 0/7/1 | 6 stages |
| 04 | uploaded | may-payroll.csv | Uploaded | no | null | null | 0 | null | [] |
| 05 | processing | may-suppliers.csv | Processing | no | null | 25 | 0 | null | 4 stages + CheckRows open |
| 06 | invalidRows | april-invalid-rows.csv | Failed InvalidRows "File has 2 invalid rows" | no | 05-01 11:40 | 15 | 0 | null | 5 stages + WaitForCorrections open |
| 07 | duplicate | bank-export-copy.csv | Failed Duplicate "File is a duplicate of another file april-batch-1.csv" | no | 05-02 09:01 | null | 0 | null | Receive, DuplicateCheck |
| 08 | cancelledCompleted | feb-legacy-import.csv | Completed | yes: 2026-04-22T15:30:00+02:00 by File Importer | 04-20 10:02 | 10 | 0 | 10/0/0 | 6 stages + Cancelled |
| 09 | cancelledFailed | wrong-bank-format.csv | Failed InvalidRows "File has 6 invalid rows" | yes: 2026-04-25T13:20:00+02:00, cancelledBy null | 04-25 13:01 | 6 | 0 | null | 5 stages + WaitForCorrections (closed) + Cancelled |
| 10 | emptyReferences | empty-reference-rows.csv | Completed | no | 04-29 16:45 | 4 | 0/0/0, fully reviewed | 0/0/4 | 6 stages |
| 11 | mixedCaseInvalid | Q1-Adjustments.csv | Failed InvalidRows "File has 3 invalid rows" | no | 04-28 08:30 | 9 | 0 | null | 5 stages + WaitForCorrections open |
| 12 | cancelledUploaded | uploaded-in-error.csv | Uploaded | yes: 2026-05-03T12:05:00+02:00 by File Importer | null | null | 0 | null | [Cancelled] |

Flags:
- **canDownload** is false only for 08, 09 and 12.
- **areTransactionsAvailable** is false only for 04, 05 and 12.
- **Fully reviewed** files are 03 and 10.
- **Unknown id:** `UNKNOWN_FILE_ID` (…09ff) returns a 404 "File not found".

## GET /files (signed in, seeded data)

**Default view** (Active, LastProcessedAt Desc, size 20) returns 9 files on 1 page, in this order:
may-payroll, may-suppliers, bank-export-copy, april-invalid-rows, april-batch-2, april-batch-1, empty-reference-rows, Q1-Adjustments, march-statement-rerun.

**Page size 5** gives 2 pages:
- Page 1: may-payroll … april-batch-2
- Page 2: april-batch-1 … march-statement-rerun

**Sort orders:**
- **FileName Asc:** april-batch-1, april-batch-2, april-invalid-rows, bank-export-copy, empty-reference-rows, march-statement-rerun, may-payroll, may-suppliers, Q1-Adjustments.
- **ImportedCount Desc:** april-batch-1 (9) first, then april-batch-2 (6).
- **RowCount Asc:** empty-reference-rows (4) first; nulls sort last.

**Filter counts:**

| Filter | Files |
|---|---|
| status=Completed | 4 |
| status=Failed | 3 |
| status=Uploaded | 1 |
| status=Processing | 1 |
| fileName=APRIL | 3 |
| fileName=batch | 2 |
| status=Failed + fileName=april | 1 |
| 30 Apr (whole local day, +02:00) | 2 |
| 27–29 Apr | 3 |
| processedFrom 1 May | 2 |
| visibility=Cancelled | 3 |
| visibility=Both | 12 |

**Reversed date range:** a reversed processedFrom/processedTo returns a 400 on processedTo. A raw `+` in a date returns a 400, so the app must encode it as `%2B`.

## Other endpoints

- **GET /dashboard/summary:**
  - Files: 1 Uploaded, 1 Processing, 4 Completed, 3 Failed.
  - Transactions: 15 Imported, 10 Approved, 5 Rejected.
- **GET /files/{id}/content:** text/csv with `content-disposition: attachment; filename=<name>; filename*=UTF-8''<name>`.
  - Cancelled files return a 410 "The original file is no longer available because the file has been cancelled."

## Overrides

**Cookie `mock-dataset`** (`MOCK_DATASET_COOKIE`; set it with `context.addCookies`):
- **empty:** no files and a summary of zeros.
- **many:** 50 active files, so 3 pages at size 20.

**Single states:**
- **Playwright:** `page.route('**/api/files/<id>', …)` with `createFileDetails({...})`.
- **Vitest:** mock `@/lib/api/client` and feed it the factories.

**Timezone:** the Playwright config sets no `timezoneId`. Specs that check local-day date filtering should use `test.use({ timezoneId: 'Africa/Johannesburg' })`.

**Real back-end seed vs mocks:** the real back-end's seed differs. The real sample file has 20 rows; the mocks use april-batch-1 (18) and april-batch-2 (12).
