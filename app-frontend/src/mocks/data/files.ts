/**
 * Project-wide mock factories for the file entities - FileListItem (GET /files),
 * FileDetails (GET /files/{id}, incl. processingHistory) and the original-file CSV
 * (GET /files/{id}/content) - plus the seeded file dataset.
 *
 * `seedDashboardFileDetails()` is the SINGLE file dataset both test layers draw from:
 * Vitest feeds it (or `seedDashboardFiles()`, its list-row view) to the mocked API
 * client, and the e2e Node mock back-end (e2e/fixtures/mock-backend.ts) filters /
 * sorts / pages it. It is a superset of the two april-batch files the transaction
 * dataset (transactions.ts) belongs to, and agrees with it: only those two files
 * hold transactions (april-batch-1: 9 Imported / 6 Approved / 3 Rejected = 18 rows;
 * april-batch-2: 6 / 4 / 2 = 12 rows), so the dashboard summary over the seeded
 * files equals the GET /transactions totals (15 / 10 / 5).
 *
 * Seeded files (12; ids `7c1e2a40-0000-4000-8000-0000000000NN`; times +02:00):
 *   NN key                   name                       status      cancelled  processed         rows  imported
 *   01 aprilBatch1           april-batch-1.csv          Completed   no         2026-04-30 18:05  18    9
 *   02 aprilBatch2           april-batch-2.csv          Completed   no         2026-04-30 18:20  12    6
 *   03 allSkipped            march-statement-rerun.csv  Completed   no         2026-04-27 09:12  8     0  (7 skipped, 1 ignored; fully reviewed)
 *   04 uploaded              may-payroll.csv            Uploaded    no         null              null  0
 *   05 processing            may-suppliers.csv          Processing  no         null              25    0  (CheckRows open)
 *   06 invalidRows           april-invalid-rows.csv     Failed      no         2026-05-01 11:40  15    0  InvalidRows "File has 2 invalid rows"
 *   07 duplicate             bank-export-copy.csv       Failed      no         2026-05-02 09:01  null  0  Duplicate "File is a duplicate of another file april-batch-1.csv"
 *   08 cancelledCompleted    feb-legacy-import.csv      Completed   yes        2026-04-20 10:02  10    0  (cancelled 2026-04-22 15:30 by File Importer)
 *   09 cancelledFailed       wrong-bank-format.csv      Failed      yes        2026-04-25 13:01  6     0  InvalidRows "File has 6 invalid rows" (cancelled 13:20, cancelledBy null)
 *   10 emptyReferences       empty-reference-rows.csv   Completed   no         2026-04-29 16:45  4     0  (4 ignored; fully reviewed)
 *   11 mixedCaseInvalid      Q1-Adjustments.csv         Failed      no         2026-04-28 08:30  9     0  InvalidRows "File has 3 invalid rows"
 *   12 cancelledUploaded     uploaded-in-error.csv      Uploaded    yes        null              null  0  (cancelled 2026-05-03 12:05 by File Importer)
 *
 * Imports are type-only and relative so the Playwright runtime can load this file
 * without `@/` alias plumbing.
 */
import type {
  FileDetails,
  FileListItem,
  FilePage,
  ProcessingStage,
  ProcessingStageEntry,
  TransactionFile,
} from '../../types/api-generated';

/** Ids of the two seeded files the transactions belong to (UUIDs, as the proxy validates ids). */
export const SEEDED_FILE_IDS = {
  aprilBatch1: '7c1e2a40-0000-4000-8000-000000000001',
  aprilBatch2: '7c1e2a40-0000-4000-8000-000000000002',
} as const;

/** Ids of every seeded dashboard file, keyed by the case it covers (see header table). */
export const DASHBOARD_FILE_IDS = {
  ...SEEDED_FILE_IDS,
  allSkipped: '7c1e2a40-0000-4000-8000-000000000003',
  uploaded: '7c1e2a40-0000-4000-8000-000000000004',
  processing: '7c1e2a40-0000-4000-8000-000000000005',
  invalidRows: '7c1e2a40-0000-4000-8000-000000000006',
  duplicate: '7c1e2a40-0000-4000-8000-000000000007',
  cancelledCompleted: '7c1e2a40-0000-4000-8000-000000000008',
  cancelledFailed: '7c1e2a40-0000-4000-8000-000000000009',
  emptyReferences: '7c1e2a40-0000-4000-8000-000000000010',
  mixedCaseInvalid: '7c1e2a40-0000-4000-8000-000000000011',
  cancelledUploaded: '7c1e2a40-0000-4000-8000-000000000012',
} as const;

export type DashboardFileKey = keyof typeof DASHBOARD_FILE_IDS;

/** A well-formed UUID no seeded file has (GET /files/{id} -> 404 "File not found"). */
export const UNKNOWN_FILE_ID = '7c1e2a40-0000-4000-8000-0000000009ff';

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

/** Name of the person who uploads and cancels the seeded files. */
export const SEEDED_UPLOADER = 'File Importer';

/** The exact 404 body message of GET /files/{id} for an unknown file. */
export const FILE_NOT_FOUND_MESSAGE = 'File not found';

/** The exact 410 body message of GET /files/{id}/content for a cancelled file. */
export const FILE_CONTENT_DISCARDED_MESSAGE =
  'The original file is no longer available because the file has been cancelled.';

// ---------------------------------------------------------------------------
// Processing history helpers
// ---------------------------------------------------------------------------

const OFFSET = '+02:00';
const OFFSET_MS = 2 * 60 * 60 * 1000;

/** `yyyy-MM-ddTHH:mm:ss` (local, +02:00) shifted by `seconds`, back as an offset ISO string. */
function shift(local: string, seconds: number): string {
  const ms = Date.parse(`${local}${OFFSET}`) + seconds * 1000;
  return `${new Date(ms + OFFSET_MS).toISOString().slice(0, 19)}${OFFSET}`;
}

/** The stages of a file that was loaded (Completed). */
export const LOADED_STAGES: readonly ProcessingStage[] = [
  'Receive',
  'DuplicateCheck',
  'ReadRows',
  'ConvertTypes',
  'CheckRows',
  'Load',
];

/** The finished stages before a file with invalid rows waits for corrections. */
export const CHECKED_STAGES: readonly ProcessingStage[] = [
  'Receive',
  'DuplicateCheck',
  'ReadRows',
  'ConvertTypes',
  'CheckRows',
];

/**
 * Finished stages, one second each, the last one finishing at `endLocal`
 * (`yyyy-MM-ddTHH:mm:ss`, +02:00).
 */
export function stagesEndingAt(
  stages: readonly ProcessingStage[],
  endLocal: string,
): ProcessingStageEntry[] {
  return stages.map((stage, i) => ({
    stage,
    startedAt: shift(endLocal, i - stages.length),
    finishedAt: shift(endLocal, i - stages.length + 1),
  }));
}

/** A stage still under way (finishedAt null), started at `startLocal`. */
export function openStage(
  stage: ProcessingStage,
  startLocal: string,
): ProcessingStageEntry {
  return { stage, startedAt: shift(startLocal, 0), finishedAt: null };
}

/** A stage that started and finished at `startLocal` / `endLocal`. */
export function closedStage(
  stage: ProcessingStage,
  startLocal: string,
  endLocal: string = startLocal,
): ProcessingStageEntry {
  return {
    stage,
    startedAt: shift(startLocal, 0),
    finishedAt: shift(endLocal, 0),
  };
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/** Canonical default: a completed, processed bank-transactions file (april-batch-1.csv). */
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
    importedCount: 9,
    isCancelled: false,
    ...overrides,
  };
}

/**
 * Canonical default details: april-batch-1.csv, Completed, 18 rows all loaded,
 * 9 Imported / 6 Approved / 3 Rejected, full processing history.
 *
 * The three flags follow the (overridden) status unless overridden themselves, as
 * the back-end derives them:
 *   - isFullyReviewed          Completed, not cancelled, transactions.imported 0
 *   - areTransactionsAvailable Completed or Failed
 *   - canDownload              not cancelled
 * Every other field is taken as given - override the row counts, history, failure
 * and cancellation fields to match the state you model (or start from
 * `seededFileDetails(DASHBOARD_FILE_IDS.<case>)`).
 */
export function createFileDetails(
  overrides: Partial<FileDetails> = {},
): FileDetails {
  const base: FileDetails = {
    id: SEEDED_FILE_IDS.aprilBatch1,
    fileName: 'april-batch-1.csv',
    kind: 'BankTransactions',
    status: 'Completed',
    failureKind: null,
    failureReason: null,
    uploadedBy: SEEDED_UPLOADER,
    uploadedAt: '2026-04-30T18:04:00+02:00',
    lastProcessedAt: '2026-04-30T18:05:00+02:00',
    isCancelled: false,
    cancelledAt: null,
    cancelledBy: null,
    rowCount: 18,
    loadedCount: 18,
    skippedExistingCount: 0,
    ignoredEmptyReferenceCount: 0,
    transactions: { imported: 9, approved: 6, rejected: 3 },
    isFullyReviewed: false,
    areTransactionsAvailable: true,
    canDownload: true,
    processingHistory: stagesEndingAt(LOADED_STAGES, '2026-04-30T18:05:00'),
    ...overrides,
  };
  return {
    ...base,
    isFullyReviewed:
      overrides.isFullyReviewed ??
      (base.status === 'Completed' &&
        !base.isCancelled &&
        base.transactions.imported === 0),
    areTransactionsAvailable:
      overrides.areTransactionsAvailable ??
      (base.status === 'Completed' || base.status === 'Failed'),
    canDownload: overrides.canDownload ?? !base.isCancelled,
  };
}

/** The list-row view of a details record (importedCount = transactions still Imported). */
export function toFileListItem(details: FileDetails): FileListItem {
  return {
    id: details.id,
    fileName: details.fileName,
    status: details.status,
    failureKind: details.failureKind,
    failureReason: details.failureReason,
    lastProcessedAt: details.lastProcessedAt,
    rowCount: details.rowCount,
    importedCount: details.transactions.imported,
    isCancelled: details.isCancelled,
  };
}

const NO_TRANSACTIONS = { imported: 0, approved: 0, rejected: 0 } as const;
const NOT_LOADED = {
  loadedCount: null,
  skippedExistingCount: null,
  ignoredEmptyReferenceCount: null,
} as const;

// ---------------------------------------------------------------------------
// Seeded dataset
// ---------------------------------------------------------------------------

/** The 12 seeded files as full details records (fresh copies, in received order 01..12 by id). */
export function seedDashboardFileDetails(): FileDetails[] {
  const ids = DASHBOARD_FILE_IDS;
  return [
    createFileDetails({
      id: ids.aprilBatch1,
      fileName: 'april-batch-1.csv',
      uploadedAt: '2026-04-30T18:04:00+02:00',
      lastProcessedAt: '2026-04-30T18:05:00+02:00',
      rowCount: 18,
      loadedCount: 18,
      skippedExistingCount: 0,
      ignoredEmptyReferenceCount: 0,
      transactions: { imported: 9, approved: 6, rejected: 3 },
      processingHistory: stagesEndingAt(LOADED_STAGES, '2026-04-30T18:05:00'),
    }),
    createFileDetails({
      id: ids.aprilBatch2,
      fileName: 'april-batch-2.csv',
      uploadedAt: '2026-04-30T18:19:00+02:00',
      lastProcessedAt: '2026-04-30T18:20:00+02:00',
      rowCount: 12,
      loadedCount: 12,
      skippedExistingCount: 0,
      ignoredEmptyReferenceCount: 0,
      transactions: { imported: 6, approved: 4, rejected: 2 },
      processingHistory: stagesEndingAt(LOADED_STAGES, '2026-04-30T18:20:00'),
    }),
    createFileDetails({
      id: ids.allSkipped,
      fileName: 'march-statement-rerun.csv',
      uploadedAt: '2026-04-27T09:10:00+02:00',
      lastProcessedAt: '2026-04-27T09:12:00+02:00',
      rowCount: 8,
      loadedCount: 0,
      skippedExistingCount: 7,
      ignoredEmptyReferenceCount: 1,
      transactions: { ...NO_TRANSACTIONS },
      processingHistory: stagesEndingAt(LOADED_STAGES, '2026-04-27T09:12:00'),
    }),
    createFileDetails({
      id: ids.uploaded,
      fileName: 'may-payroll.csv',
      status: 'Uploaded',
      uploadedAt: '2026-05-04T08:00:00+02:00',
      lastProcessedAt: null,
      rowCount: null,
      ...NOT_LOADED,
      transactions: { ...NO_TRANSACTIONS },
      processingHistory: [],
    }),
    createFileDetails({
      id: ids.processing,
      fileName: 'may-suppliers.csv',
      status: 'Processing',
      uploadedAt: '2026-05-04T07:50:00+02:00',
      lastProcessedAt: null,
      rowCount: 25,
      ...NOT_LOADED,
      transactions: { ...NO_TRANSACTIONS },
      processingHistory: [
        ...stagesEndingAt(
          ['Receive', 'DuplicateCheck', 'ReadRows', 'ConvertTypes'],
          '2026-05-04T07:51:04',
        ),
        openStage('CheckRows', '2026-05-04T07:51:04'),
      ],
    }),
    createFileDetails({
      id: ids.invalidRows,
      fileName: 'april-invalid-rows.csv',
      status: 'Failed',
      failureKind: 'InvalidRows',
      failureReason: 'File has 2 invalid rows',
      uploadedAt: '2026-05-01T11:38:00+02:00',
      lastProcessedAt: '2026-05-01T11:40:00+02:00',
      rowCount: 15,
      ...NOT_LOADED,
      transactions: { ...NO_TRANSACTIONS },
      processingHistory: [
        ...stagesEndingAt(CHECKED_STAGES, '2026-05-01T11:40:00'),
        openStage('WaitForCorrections', '2026-05-01T11:40:00'),
      ],
    }),
    createFileDetails({
      id: ids.duplicate,
      fileName: 'bank-export-copy.csv',
      status: 'Failed',
      failureKind: 'Duplicate',
      failureReason: 'File is a duplicate of another file april-batch-1.csv',
      uploadedAt: '2026-05-02T09:00:00+02:00',
      lastProcessedAt: '2026-05-02T09:01:00+02:00',
      rowCount: null,
      ...NOT_LOADED,
      transactions: { ...NO_TRANSACTIONS },
      processingHistory: stagesEndingAt(
        ['Receive', 'DuplicateCheck'],
        '2026-05-02T09:01:00',
      ),
    }),
    createFileDetails({
      id: ids.cancelledCompleted,
      fileName: 'feb-legacy-import.csv',
      uploadedAt: '2026-04-20T10:00:00+02:00',
      lastProcessedAt: '2026-04-20T10:02:00+02:00',
      isCancelled: true,
      cancelledAt: '2026-04-22T15:30:00+02:00',
      cancelledBy: SEEDED_UPLOADER,
      rowCount: 10,
      loadedCount: 10,
      skippedExistingCount: 0,
      ignoredEmptyReferenceCount: 0,
      transactions: { ...NO_TRANSACTIONS },
      processingHistory: [
        ...stagesEndingAt(LOADED_STAGES, '2026-04-20T10:02:00'),
        closedStage('Cancelled', '2026-04-22T15:30:00'),
      ],
    }),
    createFileDetails({
      id: ids.cancelledFailed,
      fileName: 'wrong-bank-format.csv',
      status: 'Failed',
      failureKind: 'InvalidRows',
      failureReason: 'File has 6 invalid rows',
      uploadedAt: '2026-04-25T13:00:00+02:00',
      lastProcessedAt: '2026-04-25T13:01:00+02:00',
      isCancelled: true,
      cancelledAt: '2026-04-25T13:20:00+02:00',
      cancelledBy: null,
      rowCount: 6,
      ...NOT_LOADED,
      transactions: { ...NO_TRANSACTIONS },
      processingHistory: [
        ...stagesEndingAt(CHECKED_STAGES, '2026-04-25T13:01:00'),
        closedStage(
          'WaitForCorrections',
          '2026-04-25T13:01:00',
          '2026-04-25T13:20:00',
        ),
        closedStage('Cancelled', '2026-04-25T13:20:00'),
      ],
    }),
    createFileDetails({
      id: ids.emptyReferences,
      fileName: 'empty-reference-rows.csv',
      uploadedAt: '2026-04-29T16:44:00+02:00',
      lastProcessedAt: '2026-04-29T16:45:00+02:00',
      rowCount: 4,
      loadedCount: 0,
      skippedExistingCount: 0,
      ignoredEmptyReferenceCount: 4,
      transactions: { ...NO_TRANSACTIONS },
      processingHistory: stagesEndingAt(LOADED_STAGES, '2026-04-29T16:45:00'),
    }),
    createFileDetails({
      id: ids.mixedCaseInvalid,
      fileName: 'Q1-Adjustments.csv',
      status: 'Failed',
      failureKind: 'InvalidRows',
      failureReason: 'File has 3 invalid rows',
      uploadedAt: '2026-04-28T08:29:00+02:00',
      lastProcessedAt: '2026-04-28T08:30:00+02:00',
      rowCount: 9,
      ...NOT_LOADED,
      transactions: { ...NO_TRANSACTIONS },
      processingHistory: [
        ...stagesEndingAt(CHECKED_STAGES, '2026-04-28T08:30:00'),
        openStage('WaitForCorrections', '2026-04-28T08:30:00'),
      ],
    }),
    createFileDetails({
      id: ids.cancelledUploaded,
      fileName: 'uploaded-in-error.csv',
      status: 'Uploaded',
      uploadedAt: '2026-05-03T12:00:00+02:00',
      lastProcessedAt: null,
      isCancelled: true,
      cancelledAt: '2026-05-03T12:05:00+02:00',
      cancelledBy: SEEDED_UPLOADER,
      rowCount: null,
      ...NOT_LOADED,
      transactions: { ...NO_TRANSACTIONS },
      processingHistory: [closedStage('Cancelled', '2026-05-03T12:05:00')],
    }),
  ];
}

/** The 12 seeded files as list rows (fresh copies, in received order). */
export function seedDashboardFiles(): FileListItem[] {
  return seedDashboardFileDetails().map(toFileListItem);
}

/** Details of the seeded file with `id` (fresh copy), or undefined. */
export function seededFileDetails(id: string): FileDetails | undefined {
  return seedDashboardFileDetails().find(
    (f) => f.id.toLowerCase() === id.toLowerCase(),
  );
}

/** Number of extra files in the `many` dataset (see `seedManyFileDetails`). */
export const BULK_FILE_COUNT = 41;

/**
 * The 12 seeded files plus 41 older Completed files `bulk-import-01.csv` ..
 * `bulk-import-41.csv` (every row skipped as existing, so no transactions; processed
 * 2026-04-01 .. 2026-04-21, older than every seeded file). 50 active files ->
 * 3 pages at the default 20. Ids `7c1e2a40-0000-4000-8000-0000000001NN`.
 */
export function seedManyFileDetails(): FileDetails[] {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const bulk = Array.from({ length: BULK_FILE_COUNT }, (_, i) => {
    const n = i + 1;
    const day = pad(1 + Math.floor(i / 2));
    const hour = i % 2 === 0 ? '09' : '15';
    const processed = `2026-04-${day}T${hour}:00:00`;
    const rows = 30 + n;
    return createFileDetails({
      id: `7c1e2a40-0000-4000-8000-0000000001${pad(n)}`,
      fileName: `bulk-import-${pad(n)}.csv`,
      uploadedAt: `2026-04-${day}T${hour === '09' ? '08' : '14'}:59:00${OFFSET}`,
      lastProcessedAt: `${processed}${OFFSET}`,
      rowCount: rows,
      loadedCount: 0,
      skippedExistingCount: rows,
      ignoredEmptyReferenceCount: 0,
      transactions: { ...NO_TRANSACTIONS },
      processingHistory: stagesEndingAt(LOADED_STAGES, processed),
    });
  });
  return [...seedDashboardFileDetails(), ...bulk];
}

/**
 * The two april-batch files the transaction dataset belongs to (18 + 12 rows),
 * as list rows. Kept for the transactions-list tests' file picker.
 */
export function seedFiles(): FileListItem[] {
  return seedDashboardFiles().filter(
    (f) =>
      f.id === SEEDED_FILE_IDS.aprilBatch1 ||
      f.id === SEEDED_FILE_IDS.aprilBatch2,
  );
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

// ---------------------------------------------------------------------------
// Original file content (GET /files/{id}/content)
// ---------------------------------------------------------------------------

/** Header row of an uploaded bank-transactions CSV. */
export const FILE_CONTENT_HEADER =
  'Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency';

/**
 * The original CSV of `file`, exactly as the mock back-end serves it (CRLF line
 * endings, header + `rowCount` rows, 3 when not counted yet). Deterministic per file.
 */
export function fileContentFor(
  file: Pick<FileDetails, 'fileName' | 'rowCount'>,
): string {
  const rows = file.rowCount ?? 3;
  const stem = file.fileName.replace(/\.csv$/i, '').toUpperCase();
  const lines = [FILE_CONTENT_HEADER];
  for (let n = 1; n <= rows; n += 1) {
    const ref = `${stem}-${String(n).padStart(4, '0')}`;
    const day = String(1 + ((n - 1) % 28)).padStart(2, '0');
    const amount = (100 + n * 37.25).toFixed(2);
    const type = n % 3 === 0 ? 'D' : 'C';
    lines.push(
      `${ref},2026/04/${day} 08:${String(n % 60).padStart(2, '0')},1001-2034-5567,Mock row ${n},${amount},${type},ZAR`,
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** `Content-Disposition` of a download of `fileName` (filename + RFC 5987 filename*). */
export function contentDispositionFor(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  const quoted = /[\s;,]/.test(ascii) ? `"${ascii}"` : ascii;
  return `attachment; filename=${quoted}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
