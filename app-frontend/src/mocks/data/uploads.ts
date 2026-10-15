/**
 * Project-wide mock factory for the UploadedFile entity (POST /files 201 body) and the
 * exact wording of every POST /files refusal, shared by both test layers:
 *   - Vitest resolves the mocked `uploadFile` with `createUploadedFile()` and asserts
 *     the refusal constants verbatim (the client pre-checks use the same wording).
 *   - The e2e Node mock back-end (e2e/fixtures/mock-backend.ts) answers POST /files
 *     with `createUploadedFile()` and these messages, in the contract's order.
 * Messages are copied from app-backend (UploadRequestFilter.cs, UploadFile.feature)
 * and app-backend/docs/TransactionApi.yaml POST /files.
 *
 * Imports are type-only (or relative) so the Playwright runtime can load this file
 * without `@/` alias plumbing.
 */
import type { FileDetails, UploadedFile } from '../../types/api-generated';
import { createFileDetails, SEEDED_UPLOADER } from './files';

/** 400 `{ message }` - empty name, over 255 characters, or containing `..`, `\`, `/` or `:`. */
export const INVALID_FILE_NAME_MESSAGE = 'Invalid file name';

/** 400 `{ message }` - the file name does not end in `.csv` (any case). */
export const NOT_CSV_MESSAGE =
  'Only .csv files can be uploaded. Please choose a .csv file.';

/** 400 `{ message }` - more than one file in the request. */
export const ONE_FILE_AT_A_TIME_MESSAGE = 'Upload one file at a time.';

/** 413 `{ message }` - larger than the (production-configured, 10 MB) maximum upload size. */
export const FILE_TOO_LARGE_MESSAGE =
  'The file is too large. Files can be up to 10 MB.';

/** 415 `{ message }` - the request is not multipart/form-data. */
export const NOT_MULTIPART_MESSAGE =
  'Files must be uploaded as multipart/form-data.';

/** 400 `{ message }` - the multipart body cannot be read (no boundary, ends early). */
export const UNREADABLE_UPLOAD_MESSAGE =
  'The upload request could not be read. Please send the file as multipart/form-data.';

/** 400 ValidationProblem `errors.file[0]` - no file in the field `file`. */
export const FILE_REQUIRED_MESSAGE = 'The file field is required.';

/** Name of the canonical uploaded file (the brief's example daily file). */
export const UPLOADED_FILE_NAME = 'transactions_2026-04-15.csv';

/** Id of the canonical uploaded file (outside the seeded file id ranges). */
export const UPLOADED_FILE_ID = '7c1e2a40-0000-4000-8000-000000000201';

/**
 * Canonical default: transactions_2026-04-15.csv, just received (status Uploaded,
 * kind BankTransactions). Override `fileName` / `id` to match the file you upload.
 */
export function createUploadedFile(
  overrides: Partial<UploadedFile> = {},
): UploadedFile {
  return {
    id: UPLOADED_FILE_ID,
    fileName: UPLOADED_FILE_NAME,
    kind: 'BankTransactions',
    status: 'Uploaded',
    uploadedAt: '2026-04-15T08:30:00+02:00',
    ...overrides,
  };
}

/**
 * The GET /files/{id} details of a file straight after upload: status Uploaded,
 * never processed, no rows counted, no transactions, empty processing history,
 * uploaded by the seeded Importer.
 */
export function uploadedFileDetails(
  uploaded: UploadedFile,
  uploadedBy: string = SEEDED_UPLOADER,
): FileDetails {
  return createFileDetails({
    id: uploaded.id,
    fileName: uploaded.fileName,
    kind: uploaded.kind,
    status: uploaded.status,
    failureKind: null,
    failureReason: null,
    uploadedBy,
    uploadedAt: uploaded.uploadedAt,
    lastProcessedAt: null,
    rowCount: null,
    loadedCount: null,
    skippedExistingCount: null,
    ignoredEmptyReferenceCount: null,
    transactions: { imported: 0, approved: 0, rejected: 0 },
    processingHistory: [],
  });
}
