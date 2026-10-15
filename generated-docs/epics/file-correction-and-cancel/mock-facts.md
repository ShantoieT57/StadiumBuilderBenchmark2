# Mock dataset facts — file-correction-and-cancel

The mock data and server below are **read-only** for test generators:
- `app-frontend/src/mocks/data/invalidRows.ts`
- `app-frontend/src/mocks/data/files.ts` (`cannotCancelMessage(n)`, `cancelledFileDetails`)
- `app-frontend/e2e/fixtures/mock-backend.ts`

The base seeded files are listed in `../file-dashboard-and-details/mock-facts.md`.

## Isolation: the `mock-run` cookie

Saves, re-checks and cancels are kept only for requests carrying the same `mock-run` cookie value. Every spec that changes data and then reads it back must set it:

```ts
context.addCookies([{ name: MOCK_RUN_COOKIE, value: mockRunValue(testInfo), url: baseURL }])
```

- Without the cookie, a change still gets the correct answer, but nothing is kept.
- `POST /__mock/reset` on :5199 resets a run.
- The mock does not emit `file-changed` events. Specs keep stubbing `/api/events`.

## Ids

- File ids: `7c1e2a40-0000-4000-8000-0000000000NN`
- Row ids: `3b5e1c70-0000-4000-8000-NN00000000RR` (NN = file, RR = row number)

## File 06 — `april-invalid-rows.csv` (15 rows, 2 invalid)

| Row | Reference | Values | Reasons |
|---|---|---|---|
| 4 | APRIL-INVALID-ROWS-0004 | date `2026/13/45 08:04`, account empty, `Mock row 4`, `249.00`, `C`, `ZAR` | Invalid Transaction Date, Missing Account Number |
| 11 | APRIL-INVALID-ROWS-0011 | amount `-509.75`, `2026/04/11 08:11`, `1001-2034-5567`, `C`, `ZAR` | Invalid Amount |

**Passes when:**
- row 4 gets date `2026/04/04 08:04` and account `1001-2034-5567`, and
- row 11 gets amount `509.75`.

The file is then Completed: 15 loaded / 0 skipped / 0 ignored, 15 Imported. The summary becomes 5 Completed / 2 Failed / 30 Imported.

**Fixing only row 4:** the file stays Failed with "File has 1 invalid row", and 1 row is listed.

## File 11 — `Q1-Adjustments.csv` (9 rows, 3 invalid)

- **Rows 3 and 7:** `Q1-ADJUSTMENTS-0003` and `q1-adjustments-0003`. Each has the reason Duplicate Reference In File.
- **Row 5:** type `X`, reason Invalid Transaction Type.
- **Row 9:** empty reference, so it is ignored and never listed.

**Passes when:**
- row 5's type is `C`, and
- row 7's reference is `Q1-ADJUSTMENTS-0007`.

The file is then Completed: 8 loaded / 1 ignored.

## Rules

- **Bad values are never refused with a 400.** They stay invalid on re-check. To show a server field error under a row (story 1 AC-4), answer that call via `page.route()` with a ValidationProblem keyed `corrections[i].<field>`.
- **After a passing re-check:** invalid-rows and recheck both answer 409 "This file is not waiting for corrections."

## Cancelling

- **Refused:**
  - 01 april-batch-1 → 409 "This file cannot be cancelled because 6 of its transactions have been approved."
  - 02 april-batch-2 → the same message with 4.
- **Allowed:** every other file.
- **After cancelling 06:**
  - The Active list has 8 files; the Cancelled view has 4.
  - The summary shows 2 Failed.
  - Content answers 410; invalid-rows answers 409.
  - Cancelled by "File Importer".
- **Already-cancelled files** (08, 09, 12): return 200 with their original cancel time and person.

## Messages

- "This file is not waiting for corrections."
- "Only the file's invalid rows can be corrected."
- "Each row can be corrected only once in a request."
- "File has N invalid rows" (singular: "File has 1 invalid row")

## Environment

Always run Playwright with `E2E_PROD=1` on port 3100. Port 3000 is a Docker container.
