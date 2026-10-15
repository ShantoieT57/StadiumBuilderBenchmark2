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
 * Imports are type-only and relative so the Playwright runtime can load this file
 * without `@/` alias plumbing.
 */
import type {
  TransactionDetails,
  TransactionListItem,
  TransactionPage,
  TransactionStatus,
  TransactionType,
} from '../../types/api-generated';
import { seededTransactionFiles } from './files';

/** The display name of the seeded approver who approved / rejected seeded rows. */
const APPROVER_NAME = 'Approver User';

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
