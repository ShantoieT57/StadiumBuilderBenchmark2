/**
 * Project-wide mock factory for the ImportedTransactionCount entity
 * (GET /transactions/imported-count, Approver only) - the Transactions menu badge.
 *
 * The count is the number of transactions still Imported over files that are not
 * cancelled. Over the seeded dataset (./transactions) that is SEEDED_IMPORTED_COUNT
 * (15); approving or rejecting one in an e2e `mock-run` lowers it by one.
 *
 * Badge boundaries for Vitest: 0 (hidden), 1..99 (exact), 100+ ("99+").
 *
 * Imports are type-only and relative so the Playwright runtime can load this file
 * without `@/` alias plumbing.
 */
import type {
  ImportedTransactionCount,
  TransactionStatus,
} from '../../types/api-generated';

/** Imported transactions in the seeded dataset (also in the `many` e2e dataset). */
export const SEEDED_IMPORTED_COUNT = 15;

/** Canonical default: the seeded count, `{ count: 15 }`. */
export function createImportedTransactionCount(
  overrides: Partial<ImportedTransactionCount> = {},
): ImportedTransactionCount {
  return { count: SEEDED_IMPORTED_COUNT, ...overrides };
}

/** The count body over `transactions` (those whose status is Imported). */
export function importedCountOf(
  transactions: readonly { status: TransactionStatus }[],
): ImportedTransactionCount {
  return {
    count: transactions.filter((t) => t.status === 'Imported').length,
  };
}
