/**
 * Project-wide mock factory for the DashboardSummary entity (GET /dashboard/summary).
 *
 * Counts cover every file that is NOT cancelled (BR1), computed from the seeded file
 * dataset in ./files, so they agree with GET /files (default Active view) and with
 * GET /transactions:
 *   seeded -> files { uploaded 1, processing 1, completed 4, failed 3 },
 *             transactions { imported 15, approved 10, rejected 5 }
 *
 * Imports are type-only and relative so the Playwright runtime can load this file
 * without `@/` alias plumbing.
 */
import type {
  DashboardSummary,
  FileDetails,
  FileStatusCounts,
  TransactionStatusCounts,
} from '../../types/api-generated';
import { seedDashboardFileDetails } from './files';

/** The summary of `files` as the back-end computes it (cancelled files excluded). */
export function summarizeFiles(files: FileDetails[]): DashboardSummary {
  const summary: DashboardSummary = {
    files: { uploaded: 0, processing: 0, completed: 0, failed: 0 },
    transactions: { imported: 0, approved: 0, rejected: 0 },
  };
  for (const file of files) {
    if (file.isCancelled) continue;
    switch (file.status) {
      case 'Uploaded':
        summary.files.uploaded += 1;
        break;
      case 'Processing':
        summary.files.processing += 1;
        break;
      case 'Completed':
        summary.files.completed += 1;
        break;
      case 'Failed':
        summary.files.failed += 1;
        break;
    }
    summary.transactions.imported += file.transactions.imported;
    summary.transactions.approved += file.transactions.approved;
    summary.transactions.rejected += file.transactions.rejected;
  }
  return summary;
}

/** The summary with no files at all (every count 0). */
export function emptyDashboardSummary(): DashboardSummary {
  return summarizeFiles([]);
}

/**
 * Canonical default: the summary of the seeded files. Override any group's counts
 * individually, e.g. `createDashboardSummary({ files: { failed: 0 } })`.
 */
export function createDashboardSummary(
  overrides: {
    files?: Partial<FileStatusCounts>;
    transactions?: Partial<TransactionStatusCounts>;
  } = {},
): DashboardSummary {
  const seeded = summarizeFiles(seedDashboardFileDetails());
  return {
    files: { ...seeded.files, ...overrides.files },
    transactions: { ...seeded.transactions, ...overrides.transactions },
  };
}
