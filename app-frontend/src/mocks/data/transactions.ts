/**
 * Project-wide mock factories for the TransactionListItem / TransactionDetails
 * entities, the seeded transaction dataset, and the TransactionPage envelope.
 *
 * `seedTransactions()` / `seedTransactionDetails()` are the SINGLE dataset both
 * test layers draw from: Vitest feeds pages of it to the mocked API client, and the
 * e2e Node mock back-end (e2e/fixtures/mock-backend.ts) filters/sorts/pages it.
 *
 * Dataset shape (30 transactions, all in April 2026, one per day, newest = 30 Apr):
 *   - files: april-batch-1.csv (18 rows), april-batch-2.csv (12 rows)
 *   - status: 15 Imported, 10 Approved, 5 Rejected
 *   - type: 20 Credit, 10 Debit; currency ZAR throughout
 *   - 4 account numbers; amounts distinct, 2 decimals, 45.00 .. 98,250.75
 *   - reference `TXN-202604DD-00NN`, unique; id `5d0c9b10-0000-4000-8000-0000000000NN`
 *
 * Approve / reject (epic approve-and-reject) - shared by both layers:
 *   - ALREADY_APPROVED_MESSAGE / ALREADY_REJECTED_MESSAGE, `alreadyReviewedMessage(status)`
 *     and `transactionConflictBody(details)` - the 409 `{ message, transaction }` body
 *   - `checkRejectionReason(raw)` - the back-end's reason rule (trimmed, 1..500 by
 *     UTF-16 `.length`) with its exact messages, keyed `reason` (REJECTION_REASON_FIELD)
 *   - `approvedDetailsOf()` / `rejectedDetailsOf()` - an Imported record after a decision
 *   - `createRejectedTransactionDetails()` / `createApprovedTransactionDetails()`
 *   - `seededTransactionId(n)` / `seededTransactionReference(n)` and
 *     SEEDED_IMPORTED_NUMBERS / SEEDED_APPROVED_NUMBERS / SEEDED_REJECTED_NUMBERS
 *
 * Imports are type-only and relative so the Playwright runtime can load this file
 * without `@/` alias plumbing.
 */
import type {
  TransactionConflict,
  TransactionDetails,
  TransactionListItem,
  TransactionPage,
  TransactionStatus,
  TransactionType,
} from '../../types/api-generated';
import { seededTransactionFiles } from './files';

/** The display name of the seeded approver who approved / rejected seeded rows. */
const APPROVER_NAME = 'Approver User';

/** The seeded approver's display name (= `userInfoFor('Approver').name`). */
export const SEEDED_APPROVER_NAME = APPROVER_NAME;

/** The exact 404 message of GET / approve / reject for an unknown transaction. */
export const TRANSACTION_NOT_FOUND_MESSAGE = 'Transaction not found';

/** Canonical default: an imported credit from april-batch-1.csv. */
export function createTransaction(
  overrides: Partial<TransactionListItem> = {},
): TransactionListItem {
  return {
    id: '5d0c9b10-0000-4000-8000-000000000001',
    reference: 'TXN-20260415-0001',
    transactionDate: '2026-04-15T08:12:00',
    accountNumber: '1001-2034-5567',
    description: 'Salary deposit - Acme Holdings',
    amount: 15750.0,
    currency: 'ZAR',
    transactionType: 'Credit',
    status: 'Imported',
    file: { ...seededTransactionFiles.aprilBatch1 },
    ...overrides,
  };
}

/**
 * Canonical default details. The audit fields follow the status unless overridden:
 * Imported -> lastChangedBy "System"; Approved/Rejected -> the approver;
 * rejectionReason is null unless the status is Rejected.
 */
export function createTransactionDetails(
  overrides: Partial<TransactionDetails> = {},
): TransactionDetails {
  const base = createTransaction(overrides);
  const changed = base.status !== 'Imported';
  return {
    ...base,
    createdBy: 'System',
    createdAt: '2026-04-30T18:05:00+02:00',
    lastChangedBy: changed ? APPROVER_NAME : 'System',
    lastChangedAt: changed
      ? '2026-05-02T10:30:00+02:00'
      : '2026-04-30T18:05:00+02:00',
    rejectionReason:
      base.status === 'Rejected' ? 'Duplicate of an earlier payment' : null,
    ...overrides,
  };
}

/** The list-row view of a details record. */
export function toListItem(details: TransactionDetails): TransactionListItem {
  return {
    id: details.id,
    reference: details.reference,
    transactionDate: details.transactionDate,
    accountNumber: details.accountNumber,
    description: details.description,
    amount: details.amount,
    currency: details.currency,
    transactionType: details.transactionType,
    status: details.status,
    file: { ...details.file },
  };
}

const ACCOUNTS = [
  '1001-2034-5567',
  '1001-4410-0923',
  '2002-7781-3346',
  '3003-1290-8814',
] as const;

const DESCRIPTIONS = [
  'Salary deposit - Acme Holdings',
  'Municipal rates - City of Johannesburg',
  'Supplier payment - Lekker Foods',
  'Card settlement - Retail POS',
  'Rental income - Unit 4B',
  'Insurance premium - SafeGuard',
] as const;

/** Statuses by position (repeats every 6): 15 Imported, 10 Approved, 5 Rejected. */
const STATUS_CYCLE: readonly TransactionStatus[] = [
  'Imported',
  'Approved',
  'Imported',
  'Rejected',
  'Approved',
  'Imported',
];

/** Distinct two-decimal amounts, one per seeded row. */
const AMOUNTS = [
  15750.0, 245.5, 3200.0, 89.99, 12500.75, 1875.2, 640.0, 98250.75, 45.0,
  7420.1, 310.35, 22000.0, 1299.99, 560.4, 4850.0, 75.25, 33100.6, 980.0,
  2460.8, 150.15, 6100.0, 412.9, 18900.45, 2750.0, 99.5, 5300.3, 1120.0,
  64000.0, 830.65, 9999.99,
] as const;

const REJECTION_REASONS = [
  'Duplicate of an earlier payment',
  'Account number does not match the beneficiary',
  'Amount exceeds the approved limit',
] as const;

const pad = (n: number, width: number): string =>
  String(n).padStart(width, '0');

function seededRow(n: number): TransactionDetails {
  const day = pad(n, 2);
  const hour = pad(7 + (n % 10), 2);
  const minute = pad((n * 7) % 60, 2);
  const status = STATUS_CYCLE[(n - 1) % STATUS_CYCLE.length];
  const transactionType: TransactionType = n % 3 === 0 ? 'Debit' : 'Credit';
  const file =
    n % 5 === 0 || n % 5 === 3
      ? seededTransactionFiles.aprilBatch2
      : seededTransactionFiles.aprilBatch1;
  return createTransactionDetails({
    id: `5d0c9b10-0000-4000-8000-${pad(n, 12)}`,
    reference: `TXN-202604${day}-${pad(n, 4)}`,
    transactionDate: `2026-04-${day}T${hour}:${minute}:00`,
    accountNumber: ACCOUNTS[(n - 1) % ACCOUNTS.length],
    description: DESCRIPTIONS[(n - 1) % DESCRIPTIONS.length],
    amount: AMOUNTS[n - 1],
    currency: 'ZAR',
    transactionType,
    status,
    file: { ...file },
    createdBy: 'System',
    createdAt:
      file === seededTransactionFiles.aprilBatch1
        ? '2026-04-30T18:05:00+02:00'
        : '2026-04-30T18:20:00+02:00',
    lastChangedBy: status === 'Imported' ? 'System' : APPROVER_NAME,
    lastChangedAt:
      status === 'Imported'
        ? '2026-04-30T18:05:00+02:00'
        : `2026-05-${pad(1 + (n % 9), 2)}T10:30:00+02:00`,
    rejectionReason:
      status === 'Rejected'
        ? REJECTION_REASONS[n % REJECTION_REASONS.length]
        : null,
  });
}

/** Number of seeded transactions. */
export const SEEDED_TRANSACTION_COUNT = 30;

/** The seeded dataset as full details records (fresh copies, in seed order: 1 Apr .. 30 Apr). */
export function seedTransactionDetails(): TransactionDetails[] {
  return Array.from({ length: SEEDED_TRANSACTION_COUNT }, (_, i) =>
    seededRow(i + 1),
  );
}

/** The seeded dataset as list rows (fresh copies, in seed order: 1 Apr .. 30 Apr). */
export function seedTransactions(): TransactionListItem[] {
  return seedTransactionDetails().map(toListItem);
}

/** Id of seeded transaction `n` (1..30), e.g. 30 -> `5d0c9b10-0000-4000-8000-000000000030`. */
export function seededTransactionId(n: number): string {
  return `5d0c9b10-0000-4000-8000-${pad(n, 12)}`;
}

/** Reference of seeded transaction `n` (1..30), e.g. 30 -> `TXN-20260430-0030`. */
export function seededTransactionReference(n: number): string {
  return `TXN-202604${pad(n, 2)}-${pad(n, 4)}`;
}

/** Seed numbers (= day of April) of the 15 Imported seeded transactions. */
export const SEEDED_IMPORTED_NUMBERS: readonly number[] = [
  1, 3, 6, 7, 9, 12, 13, 15, 18, 19, 21, 24, 25, 27, 30,
];

/** Seed numbers of the 10 Approved seeded transactions. */
export const SEEDED_APPROVED_NUMBERS: readonly number[] = [
  2, 5, 8, 11, 14, 17, 20, 23, 26, 29,
];

/** Seed numbers of the 5 Rejected seeded transactions (reason "Account number does not match the beneficiary"). */
export const SEEDED_REJECTED_NUMBERS: readonly number[] = [4, 10, 16, 22, 28];

// ---------------------------------------------------------------------------
// Approve / reject (epic approve-and-reject)
// ---------------------------------------------------------------------------

/** The exact 409 message for a transaction that is already Approved. */
export const ALREADY_APPROVED_MESSAGE =
  'This transaction has already been approved.';

/** The exact 409 message for a transaction that is already Rejected. */
export const ALREADY_REJECTED_MESSAGE =
  'This transaction has already been rejected.';

/** The 409 message the back-end sends for a transaction already in `status`. */
export function alreadyReviewedMessage(
  status: Exclude<TransactionStatus, 'Imported'>,
): string {
  return status === 'Approved'
    ? ALREADY_APPROVED_MESSAGE
    : ALREADY_REJECTED_MESSAGE;
}

/**
 * The 409 body of approve / reject: `{ message, transaction }`, the message naming
 * the transaction's current (final) status. Defaults to an Approved transaction.
 */
export function transactionConflictBody(
  transaction: TransactionDetails = createApprovedTransactionDetails(),
): TransactionConflict {
  const status = transaction.status === 'Rejected' ? 'Rejected' : 'Approved';
  return {
    message: alreadyReviewedMessage(status),
    transaction: { ...transaction, file: { ...transaction.file } },
  };
}

/** The validation-problem key of every reason problem (POST reject 400). */
export const REJECTION_REASON_FIELD = 'reason';

/** The most characters (UTF-16 code units, JavaScript `.length`) a trimmed reason may have. */
export const MAX_REJECTION_REASON_LENGTH = 500;

/** The exact 400 message for a missing / empty / whitespace-only reason. */
export const REJECTION_REASON_REQUIRED_MESSAGE =
  'A reason is required to reject a transaction.';

/** The exact 400 message for a reason longer than 500 characters once trimmed. */
export const REJECTION_REASON_TOO_LONG_MESSAGE =
  'The reason can be at most 500 characters.';

/** The exact 400 message when `reason` is not a string (reported under `reason` AND `$`). */
export const REJECTION_REASON_NOT_A_STRING_MESSAGE =
  'The JSON value could not be converted to System.String.';

/**
 * The back-end's reason rule: trims, then requires 1..500 characters counted as
 * UTF-16 code units. Returns the trimmed reason to store, or the problem message.
 * `null` / `undefined` count as missing.
 */
export function checkRejectionReason(
  raw: string | null | undefined,
): { ok: true; reason: string } | { ok: false; message: string } {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) {
    return { ok: false, message: REJECTION_REASON_REQUIRED_MESSAGE };
  }
  if (trimmed.length > MAX_REJECTION_REASON_LENGTH) {
    return { ok: false, message: REJECTION_REASON_TOO_LONG_MESSAGE };
  }
  return { ok: true, reason: trimmed };
}

/** Who made a decision and when (ISO date-time). */
export interface ReviewStamp {
  by: string;
  at: string;
}

/** `details` as approve returns it: Approved, `lastChangedBy` / `lastChangedAt` from `stamp`. */
export function approvedDetailsOf(
  details: TransactionDetails,
  stamp: ReviewStamp,
): TransactionDetails {
  return {
    ...details,
    file: { ...details.file },
    status: 'Approved',
    lastChangedBy: stamp.by,
    lastChangedAt: stamp.at,
    rejectionReason: null,
  };
}

/** `details` as reject returns it: Rejected with the (already trimmed) `reason`, stamped. */
export function rejectedDetailsOf(
  details: TransactionDetails,
  reason: string,
  stamp: ReviewStamp,
): TransactionDetails {
  return {
    ...details,
    file: { ...details.file },
    status: 'Rejected',
    lastChangedBy: stamp.by,
    lastChangedAt: stamp.at,
    rejectionReason: reason,
  };
}

/** Canonical Approved details: TXN-20260415-0001 approved by "Approver User". */
export function createApprovedTransactionDetails(
  overrides: Partial<TransactionDetails> = {},
): TransactionDetails {
  return createTransactionDetails({ status: 'Approved', ...overrides });
}

/**
 * Canonical Rejected details: TXN-20260415-0001 rejected by "Approver User" on
 * 2026-05-02 10:30 (+02:00) with the reason "Duplicate of an earlier payment".
 */
export function createRejectedTransactionDetails(
  overrides: Partial<TransactionDetails> = {},
): TransactionDetails {
  return createTransactionDetails({ status: 'Rejected', ...overrides });
}

/**
 * A TransactionPage holding page `page` of `items` (items are sliced, not re-sorted).
 * `hasAnyTransactions` defaults to `items.length > 0`; pass `true` with an empty
 * `items` to model "no transactions match the filters".
 */
export function pageOf(
  items: TransactionListItem[],
  options: {
    page?: number;
    pageSize?: number;
    hasAnyTransactions?: boolean;
  } = {},
): TransactionPage {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 20;
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page,
    pageSize,
    totalCount: items.length,
    totalPages: items.length === 0 ? 0 : Math.ceil(items.length / pageSize),
    hasAnyTransactions: options.hasAnyTransactions ?? items.length > 0,
  };
}
