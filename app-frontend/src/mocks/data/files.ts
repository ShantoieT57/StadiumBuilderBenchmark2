/**
 * Project-wide mock factory for the FileListItem entity (GET /files) and the
 * two seeded files the transaction dataset belongs to.
 *
 * Shared by Vitest and Playwright. Imports are type-only and relative so the
 * Playwright runtime can load this file without `@/` alias plumbing.
 */
import type {
  FileListItem,
  FilePage,
  TransactionFile,
} from '../../types/api-generated';

/** Ids of the two seeded files (UUIDs, as the proxy validates ids). */
export const SEEDED_FILE_IDS = {
  aprilBatch1: '7c1e2a40-0000-4000-8000-000000000001',
  aprilBatch2: '7c1e2a40-0000-4000-8000-000000000002',
} as const;

/** The `{ id, fileName }` reference a transaction carries, for each seeded file. */
export const seededTransactionFiles: Record<
  keyof typeof SEEDED_FILE_IDS,
  TransactionFile
> = {
  aprilBatch1: {
    id: SEEDED_FILE_IDS.aprilBatch1,
    fileName: 'april-batch-1.csv',
  },
  aprilBatch2: {
    id: SEEDED_FILE_IDS.aprilBatch2,
    fileName: 'april-batch-2.csv',
  },
};

/** Canonical default: a completed, processed bank-transactions file. */
export function createFileListItem(
  overrides: Partial<FileListItem> = {},
): FileListItem {
  return {
    id: SEEDED_FILE_IDS.aprilBatch1,
    fileName: 'april-batch-1.csv',
    status: 'Completed',
    failureKind: null,
    failureReason: null,
    lastProcessedAt: '2026-04-30T18:05:00+02:00',
    rowCount: 18,
    importedCount: 18,
    isCancelled: false,
    ...overrides,
  };
}

/** The two seeded files, consistent with `seedTransactions()` (18 + 12 rows). */
export function seedFiles(): FileListItem[] {
  return [
    createFileListItem({
      id: SEEDED_FILE_IDS.aprilBatch1,
      fileName: seededTransactionFiles.aprilBatch1.fileName,
      lastProcessedAt: '2026-04-30T18:05:00+02:00',
      rowCount: 18,
      importedCount: 18,
    }),
    createFileListItem({
      id: SEEDED_FILE_IDS.aprilBatch2,
      fileName: seededTransactionFiles.aprilBatch2.fileName,
      lastProcessedAt: '2026-04-30T18:20:00+02:00',
      rowCount: 12,
      importedCount: 12,
    }),
  ];
}

/** A FilePage holding `items` (one page, unless page/pageSize say otherwise). */
export function filePageOf(
  items: FileListItem[],
  options: { page?: number; pageSize?: number } = {},
): FilePage {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 20;
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page,
    pageSize,
    totalCount: items.length,
    totalPages: items.length === 0 ? 0 : Math.ceil(items.length / pageSize),
  };
}
