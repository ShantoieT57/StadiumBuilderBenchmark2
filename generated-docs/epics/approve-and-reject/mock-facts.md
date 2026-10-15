# Mock dataset facts — approve-and-reject

Test generators must treat the mock data and server below as **read-only**:
- `app-frontend/src/mocks/data/transactions.ts`: messages, 409 body, reason rule, decided records, seeded ids
- `app-frontend/src/mocks/data/importedCount.ts`: `createImportedTransactionCount()`, `importedCountOf()`, `SEEDED_IMPORTED_COUNT`
- `app-frontend/e2e/fixtures/mock-backend.ts`: approve, reject, imported-count

The seeded transactions are listed in full below. The seeded files are in `../file-dashboard-and-details/mock-facts.md`. Cancel and correction rules are in `../file-correction-and-cancel/mock-facts.md`.

## Isolation: the `mock-run` cookie

Approve and reject decisions are kept only for requests that carry the same `mock-run` cookie value, the same as cancels and corrections. Any spec that decides and then reads back must set it:

```ts
context.addCookies([{ name: MOCK_RUN_COOKIE, value: mockRunValue(testInfo), url: baseURL }])
```

Within a run, the following all see the decisions:
- the list, including the Status filter
- `transactions/{id}`
- the files' counts
- the dashboard summary
- imported-count
- file cancel, which answers 409 when the run has approved one of the file's transactions

**Without the cookie**, a decision still gets the correct answer (200, 409 or 400), but nothing is kept.

**"Someone got there first":** approve or reject the transaction through the mock first, with a direct request that carries the same `mock-run` cookie, then confirm in the UI. The UI's call then gets a 409.

## Cookies

| Cookie | Value | Effect |
|---|---|---|
| `txn_session` | `mock-session-Approver` / `mock-session-Importer` | role (`mockSessionValue(role)`) |
| `mock-run` (`MOCK_RUN_COOKIE`) | `mockRunValue(testInfo)` | keeps decisions for this run |
| `mock-dataset` (`MOCK_DATASET_COOKIE`) | `empty` | count 0 (badge hidden), no transactions |
| `mock-dataset` | `many` | still 15 Imported. Use the next row for "99+" |
| `mock-imported-count` (`MOCK_IMPORTED_COUNT_COOKIE`) | non-negative integer, e.g. `120`, `99`, `0` | imported-count answers exactly `{ count: n }`. The value is fixed and does **not** drop with decisions |

## Ids

- Transaction `n` (1..30, the day in April 2026): id `5d0c9b10-0000-4000-8000-0000000000NN`, reference `TXN-202604NN-00NN`.
- Use `seededTransactionId(n)` and `seededTransactionReference(n)`.
- The number lists are `SEEDED_IMPORTED_NUMBERS`, `SEEDED_APPROVED_NUMBERS` and `SEEDED_REJECTED_NUMBERS`.

## Seeded transactions (all ZAR)

The default list order is date descending, 20 per page, so page 1 holds 30 down to 11.

### Imported (15): base count = 15

| n | Reference | File | Amount | Type |
|---|---|---|---|---|
| 30 | TXN-20260430-0030 | april-batch-2.csv | 9,999.99 | Debit |
| 27 | TXN-20260427-0027 | april-batch-1.csv | 1,120.00 | Debit |
| 25 | TXN-20260425-0025 | april-batch-2.csv | 99.50 | Credit |
| 24 | TXN-20260424-0024 | april-batch-1.csv | 2,750.00 | Debit |
| 21 | TXN-20260421-0021 | april-batch-1.csv | 6,100.00 | Debit |
| 19 | TXN-20260419-0019 | april-batch-1.csv | 2,460.80 | Credit |
| 18 | TXN-20260418-0018 | april-batch-2.csv | 980.00 | Debit |
| 15 | TXN-20260415-0015 | april-batch-2.csv | 4,850.00 | Debit |
| 13 | TXN-20260413-0013 | april-batch-2.csv | 1,299.99 | Credit |
| 12 | TXN-20260412-0012 | april-batch-1.csv | 22,000.00 | Debit |
| 09 | TXN-20260409-0009 | april-batch-1.csv | 45.00 | Debit |
| 07 | TXN-20260407-0007 | april-batch-1.csv | 640.00 | Credit |
| 06 | TXN-20260406-0006 | april-batch-1.csv | 1,875.20 | Debit |
| 03 | TXN-20260403-0003 | april-batch-2.csv | 3,200.00 | Debit |
| 01 | TXN-20260401-0001 | april-batch-1.csv | 15,750.00 | Credit |

Split by file: april-batch-1 has 9 Imported and april-batch-2 has 6.

### Approved (10): all by "Approver User"

| n | Reference | File | Amount |
|---|---|---|---|
| 29 | TXN-20260429-0029 | april-batch-1.csv | 830.65 |
| 26 | TXN-20260426-0026 | april-batch-1.csv | 5,300.30 |
| 23 | TXN-20260423-0023 | april-batch-2.csv | 18,900.45 |
| 20 | TXN-20260420-0020 | april-batch-2.csv | 150.15 |
| 17 | TXN-20260417-0017 | april-batch-1.csv | 33,100.60 |
| 14 | TXN-20260414-0014 | april-batch-1.csv | 560.40 |
| 11 | TXN-20260411-0011 | april-batch-1.csv | 310.35 |
| 08 | TXN-20260408-0008 | april-batch-2.csv | 98,250.75 |
| 05 | TXN-20260405-0005 | april-batch-2.csv | 12,500.75 |
| 02 | TXN-20260402-0002 | april-batch-1.csv | 245.50 |

### Rejected (5): all by "Approver User", reason "Account number does not match the beneficiary"

| n | Reference | File | Amount |
|---|---|---|---|
| 28 | TXN-20260428-0028 | april-batch-2.csv | 64,000.00 |
| 22 | TXN-20260422-0022 | april-batch-1.csv | 412.90 |
| 16 | TXN-20260416-0016 | april-batch-1.csv | 75.25 |
| 10 | TXN-20260410-0010 | april-batch-2.csv | 7,420.10 |
| 04 | TXN-20260404-0004 | april-batch-1.csv | 89.99 |

## Endpoints

All three endpoints follow the same access rules:
- They need an active session; otherwise 401.
- An Importer gets 403 with "You do not have access to this. Please ask your administrator for access."

### POST `/transactions/{id}/approve` (no body)

- A non-UUID id gets 400, keyed `transactionId`.
- An unknown id, or one whose file was cancelled in the run, gets 404 "Transaction not found".
- A transaction that is not Imported gets 409 `{ message, transaction }`. The transaction is its current details, including `rejectionReason` when Rejected.
- Otherwise the answer is 200 with `TransactionDetails`:
  - `status: Approved`
  - `lastChangedBy: "Approver User"` (the signed-in user's name)
  - `lastChangedAt`: now, as an ISO UTC string
  - `rejectionReason: null`

### POST `/transactions/{id}/reject` with body `{ reason }`

The reason is checked **before** the transaction, so an invalid reason gets a 400 whatever the transaction's status.

| Body | Answer |
|---|---|
| empty | 400 `errors.$` = "A non-empty request body is required." |
| unreadable JSON | 400 keyed `$` |
| `reason` is not a string (e.g. `42`) | 400 keyed `reason` **and** `$` |
| `reason` is missing, null, empty or only whitespace | 400 `errors.reason` = "A reason is required to reject a transaction." |
| `reason` is over 500 UTF-16 code units (`.length`) after trimming | 400 `errors.reason` = "The reason can be at most 500 characters." (an emoji counts as 2) |

After a valid reason, the rules are the same as approve. The 200 answer has `status: Rejected`, and `rejectionReason` is the **trimmed** reason.

### GET `/transactions/imported-count`

Answers `{ count }`: the number of Imported transactions in the dataset plus the run's changes.

| Case | Count |
|---|---|
| seeded | 15 |
| `many` | 15 |
| `empty` | 0 |

Within a run, the count drops by 1 for each decision. It rises when a passing re-check of file 06 loads 15 more transactions (30 in total).

## Messages

These are exported from `transactions.ts`:
- `ALREADY_APPROVED_MESSAGE`: "This transaction has already been approved."
- `ALREADY_REJECTED_MESSAGE`: "This transaction has already been rejected."
- `alreadyReviewedMessage(status)`
- `transactionConflictBody(details)`: the 409 body `{ message, transaction }`
- `REJECTION_REASON_REQUIRED_MESSAGE`: "A reason is required to reject a transaction."
- `REJECTION_REASON_TOO_LONG_MESSAGE`: "The reason can be at most 500 characters."
- `REJECTION_REASON_FIELD`: `reason`
- `MAX_REJECTION_REASON_LENGTH`: 500
- `TRANSACTION_NOT_FOUND_MESSAGE`: "Transaction not found"
- `checkRejectionReason(raw)`

Factories:
- `createApprovedTransactionDetails()`
- `createRejectedTransactionDetails()`: TXN-20260415-0001, reason "Duplicate of an earlier payment", by "Approver User", at 2026-05-02T10:30:00+02:00
- `approvedDetailsOf(details, { by, at })`
- `rejectedDetailsOf(details, reason, { by, at })`
- `createImportedTransactionCount({ count })`

## Side effects inside a run

- **Approving one Imported transaction from april-batch-2:** cancelling april-batch-2 now answers 409 "This file cannot be cancelled because 5 of its transactions have been approved." Before the approval, the number was 4.
- **Approving one Imported transaction from april-batch-1:** the number becomes 7.
- **Dashboard summary:** after one approve and one reject, it shows 13 Imported / 11 Approved / 6 Rejected.
- **Status filter `Imported`:** the list's `totalCount` drops by one per decision.

## Events

The mock emits **no** SSE events: no `transactions-changed` and no `resync`. Specs stub `/api/events` with `page.route()` to deliver them, after changing state through the mock.

## Environment

Always run Playwright with `E2E_PROD=1` on port 3100. Port 3000 is a Docker container.
