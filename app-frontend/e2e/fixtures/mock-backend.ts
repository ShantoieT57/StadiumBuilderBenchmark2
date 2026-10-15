/**
 * Stateless Node-side mock back-end shared by every E2E spec.
 *
 * Why it exists: the signed-in layout calls `GET /auth/me` from the Next.js SERVER
 * (BR3 / NFR-1), and `page.route()` cannot intercept Node-side fetches. During E2E,
 * playwright.config.ts points the web server's `BACKEND_URL` at this server
 * (started and stopped by e2e/global-setup.ts). Browser-side `/api/*` calls go
 * through the Next.js proxy to this server too (or can be mocked per spec with
 * `page.route()` + `respondFor()`). Specs never contact the live back-end.
 *
 * Session state lives entirely in the `txn_session` cookie value, so the mock is
 * parallel-safe and holds no shared state:
 *   - `mock-session-<Role>`            active session -> GET auth/me 200 `userInfoFor(role)`
 *   - `mock-session-<Role>-<Reason>`   ended session  -> 401 `unauthenticatedBody(reason)`
 *                                      (Reason: SessionExpired | SignedInElsewhere | SignedOut | NotSignedIn)
 *   - missing / anything else          -> 401 `unauthenticatedBody('NotSignedIn')`
 * POST auth/sign-out -> 204 and clears the cookie (anonymous, idempotent).
 *
 * Signed-in data endpoints (epic transactions-list). Each needs an ACTIVE session;
 * an ended session gets 401 with its reason, no session gets 401 NotSignedIn:
 *   - GET transactions        real query semantics over the seeded dataset
 *                             (src/mocks/data/transactions.ts `seedTransactionDetails()`):
 *                             page (>= 1, default 1; past the last page is empty),
 *                             pageSize (5 | 10 | 20 | 50, default 20),
 *                             sortBy (all 9 columns, default TransactionDate),
 *                             sortDirection (default Desc for TransactionDate, Asc otherwise;
 *                             text compared ignoring case; ties broken by reference in the
 *                             same direction), status, fileId, dateFrom / dateTo (`yyyy-MM-dd`
 *                             = whole day, inclusive, or a local date-time with no offset),
 *                             minAmount / maxAmount (inclusive), search (trimmed,
 *                             case-insensitive substring of reference OR accountNumber).
 *                             Invalid values -> 400 ValidationProblem naming the parameter.
 *                             200 body: TransactionPage.
 *   - GET transactions/{id}   200 TransactionDetails, or 404 `{ message: 'Transaction not found' }`.
 *   - GET files               real query semantics over the seeded files
 *                             (src/mocks/data/files.ts `seedDashboardFileDetails()`, 12 files, a
 *                             superset of the 2 april-batch files the transactions belong to):
 *                             page (>= 1, default 1; past the last page is empty),
 *                             pageSize (5 | 10 | 20 | 50, default 20),
 *                             sortBy FileName | LastProcessedAt | RowCount | Status | ImportedCount
 *                             (default LastProcessedAt), sortDirection (default Desc for
 *                             LastProcessedAt, Asc otherwise). FileName ignores case; Status sorts
 *                             Uploaded < Processing < Completed < Failed; nulls sort last ascending
 *                             and first descending (so never-processed files come first by
 *                             default); ties by received order (uploadedAt) in the same direction.
 *                             status, fileName (literal, case-insensitive contains),
 *                             processedFrom / processedTo (ISO date-times, inclusive; unprocessed
 *                             files never match; from later than to -> 400 on processedTo),
 *                             visibility Active (default) | Cancelled | Both.
 *                             Invalid values -> 400 ValidationProblem naming the parameter.
 *                             200 body: FilePage.
 *   - GET files/{id}          200 FileDetails, or 404 `{ message: 'File not found' }`.
 *   - GET files/{id}/content  200 `text/csv` (`fileContentFor(file)`) with
 *                             `Content-Disposition: attachment; filename=...; filename*=UTF-8''...`;
 *                             410 `{ message }` for a cancelled file; 404 for an unknown file.
 *   - GET dashboard/summary   counts over the dataset's non-cancelled files
 *                             (src/mocks/data/dashboardSummary.ts `summarizeFiles()`).
 *
 * Dataset override (per test, parallel-safe): set a `mock-dataset` cookie on the
 * browser context, e.g.
 *   context.addCookies([{ name: MOCK_DATASET_COOKIE, value: 'empty', url: baseURL }])
 * The /api proxy forwards the whole Cookie header, so browser-side calls carry it.
 *   - absent | `seeded`   the 30 seeded transactions across 2 files (default)
 *   - `empty`             no transactions and no files; GET transactions answers
 *                         hasAnyTransactions: false ("No transactions yet"); GET dashboard/summary
 *                         is all zeros; GET files/{id} is 404 for every id
 *   - `many`              the seeded transactions, and the 12 seeded files plus 41 older
 *                         Completed `bulk-import-NN.csv` files with no transactions
 *                         (50 active files: 3 pages at the default page size of 20)
 * Next.js SERVER-side fetches that forward only `txn_session` (e.g. GET auth/me) never
 * carry it, so the override applies to calls made through the browser's /api proxy.
 *
 * POST files (epic file-upload; multipart/form-data; body via the 5th `respondFor`
 * argument). Checks in the contract's order (TransactionApi.yaml POST /files), the
 * first failure decides; messages come from src/mocks/data/uploads.ts:
 *   1. no ACTIVE session -> 401 (ended reason, else NotSignedIn);
 *      Approver          -> 403 `forbiddenBody()` (identity.ts FORBIDDEN_MESSAGE)
 *   2. Content-Type not multipart/form-data -> 415 NOT_MULTIPART_MESSAGE
 *   3. no boundary / body cannot be parsed (e.g. no closing boundary)
 *                         -> 400 UNREADABLE_UPLOAD_MESSAGE
 *   4. any part larger than MOCK_UPLOAD_LIMIT_BYTES, or the whole body larger than
 *      that + 64 KB      -> 413 FILE_TOO_LARGE_MESSAGE
 *   5. more than one file (parts with a `filename`, any field, plus plain fields
 *      named `file`)     -> 400 ONE_FILE_AT_A_TIME_MESSAGE
 *   6. no part named `file` -> 400 ValidationProblem errors.file [FILE_REQUIRED_MESSAGE];
 *      a `kind` other than BankTransactions -> 400 ValidationProblem errors.kind
 *      (both reported together when both fail; a missing `kind` defaults)
 *   7. file name empty (incl. `filename=""` or a plain `file` field), over 255
 *      characters, or containing `..`, `\`, `/` or `:` -> 400 INVALID_FILE_NAME_MESSAGE
 *   8. name not ending in `.csv` (any case) -> 400 NOT_CSV_MESSAGE
 *   otherwise -> 201 UploadedFile { id (random UUID), fileName, kind: BankTransactions,
 *                status: Uploaded, uploadedAt (now, ISO) }.
 * Mock upload limit: MOCK_UPLOAD_LIMIT_BYTES = env E2E_MOCK_UPLOAD_LIMIT_BYTES, default
 * 1 MB (1048576), so specs exercise the 413 path with a ~1.1 MB buffer instead of
 * 10 MB. The 413 message is still the production wording ("... up to 10 MB."), as the
 * mock stands in for the production configuration.
 * Connection-drop hook (valid .csv names only, checked just before the 201):
 *   - name starts `drop-once-` -> the FIRST upload of that exact name in this
 *     process drops the connection; every later upload of it gets the 201 (the
 *     "Try again" path). Use a name unique to the test (and retry), e.g.
 *     `drop-once-${testInfo.testId}-${testInfo.retry}.csv`.
 *   - otherwise name starts `drop-` -> the connection is dropped every time.
 *   The server destroys the socket without answering; the Next.js /api proxy then
 *   answers 502, which the client treats as a network failure. From `respondFor`
 *   the drop shows as `dropConnection: true` (call `route.abort('connectionreset')`).
 * Uploaded files are remembered per process ONLY by id: GET files/{id} (and
 * files/{id}/content) answer them as just-uploaded details
 * (uploads.ts `uploadedFileDetails()`, status Uploaded, never processed), so the
 * "View file details" link works. They are NEVER added to GET files, GET
 * transactions or GET dashboard/summary, so the seeded counts other specs rely on
 * are unchanged. Answers made through `respondFor` inside a spec's `page.route()`
 * are remembered in the spec worker, not in this server.
 *
 * Every other request -> 401 `unauthenticatedBody('NotSignedIn')`.
 *
 * Bodies come from the project-wide mock-data sources (never inlined here).
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';

import type {
  FileDetails,
  FileKind,
  UploadedFile,
  FileSortColumn,
  FileStatus,
  FileVisibility,
  SortDirection,
  TransactionDetails,
  TransactionSortColumn,
  TransactionStatus,
  UnauthenticatedReason,
  UserRole,
  ValidationProblem,
} from '../../src/types/api-generated';
import { summarizeFiles } from '../../src/mocks/data/dashboardSummary';
import {
  FILE_CONTENT_DISCARDED_MESSAGE,
  FILE_NOT_FOUND_MESSAGE,
  contentDispositionFor,
  fileContentFor,
  filePageOf,
  seedDashboardFileDetails,
  seedManyFileDetails,
  toFileListItem,
} from '../../src/mocks/data/files';
import {
  forbiddenBody,
  unauthenticatedBody,
  userInfoFor,
} from '../../src/mocks/data/identity';
import {
  pageOf,
  seedTransactionDetails,
  toListItem,
} from '../../src/mocks/data/transactions';
import {
  FILE_REQUIRED_MESSAGE,
  FILE_TOO_LARGE_MESSAGE,
  INVALID_FILE_NAME_MESSAGE,
  NOT_CSV_MESSAGE,
  NOT_MULTIPART_MESSAGE,
  ONE_FILE_AT_A_TIME_MESSAGE,
  UNREADABLE_UPLOAD_MESSAGE,
  createUploadedFile,
  uploadedFileDetails,
} from '../../src/mocks/data/uploads';

/**
 * Largest part (file) POST files accepts in the mock, in bytes. Env
 * `E2E_MOCK_UPLOAD_LIMIT_BYTES`, default 1 MB. See the header.
 */
export const MOCK_UPLOAD_LIMIT_BYTES = Number(
  process.env.E2E_MOCK_UPLOAD_LIMIT_BYTES ?? 1024 * 1024,
);

/** Room for boundaries, part headers and other fields on top of the limit (as the back-end). */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** File-name prefix that drops the connection on every upload (see header). */
export const DROP_CONNECTION_PREFIX = 'drop-';

/** File-name prefix that drops the connection on the first upload of that name only. */
export const DROP_CONNECTION_ONCE_PREFIX = 'drop-once-';

/** Port the mock listens on (127.0.0.1). Must match playwright.config.ts. */
export const MOCK_BACKEND_PORT = Number(
  process.env.E2E_MOCK_BACKEND_PORT ?? 5199,
);

/** The back-end's session cookie name. */
export const SESSION_COOKIE = 'txn_session';

/** Cookie that selects the mock dataset for one browser context (see header). */
export const MOCK_DATASET_COOKIE = 'mock-dataset';

/** The datasets the mock can serve. */
export type MockDataset = 'seeded' | 'empty' | 'many';

const ROLES: readonly UserRole[] = ['Importer', 'Approver'];
const REASONS: readonly UnauthenticatedReason[] = [
  'NotSignedIn',
  'SessionExpired',
  'SignedInElsewhere',
  'SignedOut',
];

/** Cookie value for an ACTIVE mock session held by `role`. */
export function mockSessionValue(role: UserRole): string {
  return `mock-session-${role}`;
}

/**
 * Cookie value for a session of `role` that the back-end has ENDED for `reason`
 * (idle timeout, signed in elsewhere, ...). The mock answers 401 with that reason.
 */
export function endedSessionValue(
  role: UserRole,
  reason: UnauthenticatedReason,
): string {
  return `mock-session-${role}-${reason}`;
}

/** Raw value of cookie `name` from a `Cookie` header, or null. */
function cookieValue(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  const pair = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return pair ? pair.slice(name.length + 1) : null;
}

/** Raw `txn_session` value from a `Cookie` header, or null. */
function sessionValueFromCookie(
  cookieHeader: string | null | undefined,
): string | null {
  return cookieValue(cookieHeader, SESSION_COOKIE);
}

/** The role of an ACTIVE mock session in a `Cookie` header, or null. */
export function roleFromCookie(
  cookieHeader: string | null | undefined,
): UserRole | null {
  const value = sessionValueFromCookie(cookieHeader);
  return ROLES.find((role) => value === mockSessionValue(role)) ?? null;
}

/** The 401 reason of an ENDED mock session in a `Cookie` header, or null. */
export function endedReasonFromCookie(
  cookieHeader: string | null | undefined,
): UnauthenticatedReason | null {
  const value = sessionValueFromCookie(cookieHeader);
  for (const role of ROLES) {
    const reason = REASONS.find((r) => value === endedSessionValue(role, r));
    if (reason) return reason;
  }
  return null;
}

/** The dataset selected by the `mock-dataset` cookie (default `seeded`). */
export function datasetFromCookie(
  cookieHeader: string | null | undefined,
): MockDataset {
  const value = cookieValue(cookieHeader, MOCK_DATASET_COOKIE);
  return value === 'empty' || value === 'many' ? value : 'seeded';
}

/** `Set-Cookie` that clears the session, as the back-end does on sign-out. */
export const CLEAR_SESSION_COOKIE = `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;

export interface MockResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  /**
   * When true the connection must be dropped instead of answering (the server
   * destroys the socket; a `page.route()` handler calls `route.abort('connectionreset')`).
   */
  dropConnection?: boolean;
}

/** The raw request of a POST files call, for `respondFor`. */
export interface UploadRequest {
  /** The request's Content-Type header (with its boundary). */
  contentType: string | null | undefined;
  /** The raw request body (e.g. `route.request().postDataBuffer()`). */
  body: Buffer | Uint8Array | null | undefined;
}

/** One part of a multipart/form-data body. */
export interface MultipartPart {
  /** The form field name, or null when none was given. */
  name: string | null;
  /** The file name (`filename*` preferred), '' when sent empty, null for a plain field. */
  filename: string | null;
  data: Buffer;
}

function json(status: number, payload: unknown): MockResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

function transactionsFor(dataset: MockDataset): TransactionDetails[] {
  return dataset === 'empty' ? [] : seedTransactionDetails();
}

function filesFor(dataset: MockDataset): FileDetails[] {
  if (dataset === 'empty') return [];
  return dataset === 'many'
    ? seedManyFileDetails()
    : seedDashboardFileDetails();
}

// ---------------------------------------------------------------------------
// GET /transactions query semantics
// ---------------------------------------------------------------------------

const SORT_COLUMNS: readonly TransactionSortColumn[] = [
  'TransactionDate',
  'Reference',
  'AccountNumber',
  'Description',
  'Amount',
  'Currency',
  'TransactionType',
  'Status',
  'FileName',
];
const SORT_DIRECTIONS: readonly SortDirection[] = ['Asc', 'Desc'];
const STATUSES: readonly TransactionStatus[] = [
  'Imported',
  'Approved',
  'Rejected',
];
const PAGE_SIZES: readonly number[] = [5, 10, 20, 50];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2}(\.\d+)?)?$/;

/** Sort key of a transaction for `column` (text lower-cased). */
function sortKey(
  t: TransactionDetails,
  column: TransactionSortColumn,
): string | number {
  switch (column) {
    case 'TransactionDate':
      return t.transactionDate;
    case 'Reference':
      return t.reference.toLowerCase();
    case 'AccountNumber':
      return t.accountNumber.toLowerCase();
    case 'Description':
      return t.description.toLowerCase();
    case 'Amount':
      return t.amount;
    case 'Currency':
      return t.currency.toLowerCase();
    case 'TransactionType':
      return t.transactionType.toLowerCase();
    case 'Status':
      return t.status.toLowerCase();
    case 'FileName':
      return t.file.fileName.toLowerCase();
  }
}

function compareKeys(a: string | number, b: string | number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** A local date-time `yyyy-MM-ddTHH:mm:ss[.f]` bound for a date filter, or null if unreadable. */
function dateBound(value: string, end: boolean): string | null {
  if (DATE_ONLY.test(value)) {
    return end ? `${value}T23:59:59.9999999` : `${value}T00:00:00`;
  }
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) return null;
  return match[2] ? value : `${match[1]}:00`;
}

/** Parses a non-negative amount, or null if it is not one. */
function amountOf(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function validationProblem(errors: Record<string, string[]>): MockResponse {
  const body: ValidationProblem = {
    type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
    title: 'One or more validation errors occurred.',
    status: 400,
    errors,
  };
  return json(400, body);
}

/** GET /transactions over `dataset` with query `params`. */
function listTransactions(
  params: URLSearchParams,
  dataset: MockDataset,
): MockResponse {
  const errors: Record<string, string[]> = {};
  const fail = (name: string, message: string): void => {
    errors[name] = [message];
  };
  const get = (name: string): string | null => {
    const value = params.get(name);
    return value === null || value === '' ? null : value;
  };

  const pageRaw = get('page');
  const page = pageRaw === null ? 1 : Number(pageRaw);
  if (!Number.isInteger(page) || page < 1)
    fail('page', 'The page must be 1 or more.');

  const pageSizeRaw = get('pageSize');
  const pageSize = pageSizeRaw === null ? 20 : Number(pageSizeRaw);
  if (!PAGE_SIZES.includes(pageSize)) {
    fail('pageSize', 'The page size must be 5, 10, 20 or 50.');
  }

  const sortByRaw = get('sortBy') ?? 'TransactionDate';
  const sortBy = SORT_COLUMNS.find((c) => c === sortByRaw);
  if (!sortBy) fail('sortBy', `'${sortByRaw}' is not a sort column.`);

  const directionRaw = get('sortDirection');
  const direction: SortDirection | undefined =
    directionRaw === null
      ? sortBy === 'TransactionDate' || !sortBy
        ? 'Desc'
        : 'Asc'
      : SORT_DIRECTIONS.find((d) => d === directionRaw);
  if (!direction)
    fail('sortDirection', `'${directionRaw}' is not a sort direction.`);

  const statusRaw = get('status');
  const status =
    statusRaw === null ? null : STATUSES.find((s) => s === statusRaw);
  if (status === undefined) fail('status', `'${statusRaw}' is not a status.`);

  const fileId = get('fileId');
  if (fileId !== null && !UUID_PATTERN.test(fileId)) {
    fail('fileId', 'The file id must be a UUID.');
  }

  const dateFromRaw = get('dateFrom');
  const dateFrom = dateFromRaw === null ? null : dateBound(dateFromRaw, false);
  if (dateFromRaw !== null && dateFrom === null) {
    fail(
      'dateFrom',
      'The date must be a date or a local date and time with no offset.',
    );
  }
  const dateToRaw = get('dateTo');
  const dateTo = dateToRaw === null ? null : dateBound(dateToRaw, true);
  if (dateToRaw !== null && dateTo === null) {
    fail(
      'dateTo',
      'The date must be a date or a local date and time with no offset.',
    );
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    fail('dateTo', 'The end date must not be earlier than the start date.');
  }

  const minRaw = get('minAmount');
  const minAmount = minRaw === null ? null : amountOf(minRaw);
  if (minRaw !== null && minAmount === null) {
    fail('minAmount', 'The amount must be a number that is not negative.');
  }
  const maxRaw = get('maxAmount');
  const maxAmount = maxRaw === null ? null : amountOf(maxRaw);
  if (maxRaw !== null && maxAmount === null) {
    fail('maxAmount', 'The amount must be a number that is not negative.');
  }
  if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) {
    fail(
      'maxAmount',
      'The maximum amount must not be less than the minimum amount.',
    );
  }

  if (Object.keys(errors).length > 0 || !sortBy || !direction) {
    return validationProblem(errors);
  }

  const search = (params.get('search') ?? '').trim().toLowerCase();
  const all = transactionsFor(dataset);

  const matching = all.filter(
    (t) =>
      (!status || t.status === status) &&
      (fileId === null || t.file.id.toLowerCase() === fileId.toLowerCase()) &&
      (dateFrom === null || t.transactionDate >= dateFrom) &&
      (dateTo === null || t.transactionDate <= dateTo) &&
      (minAmount === null || t.amount >= minAmount) &&
      (maxAmount === null || t.amount <= maxAmount) &&
      (search === '' ||
        t.reference.toLowerCase().includes(search) ||
        t.accountNumber.toLowerCase().includes(search)),
  );

  const sign = direction === 'Desc' ? -1 : 1;
  const sorted = [...matching].sort(
    (a, b) =>
      sign *
      (compareKeys(sortKey(a, sortBy), sortKey(b, sortBy)) ||
        compareKeys(a.reference.toLowerCase(), b.reference.toLowerCase())),
  );

  return json(
    200,
    pageOf(sorted.map(toListItem), {
      page,
      pageSize,
      hasAnyTransactions: all.length > 0,
    }),
  );
}

/** GET /transactions/{id} over `dataset`. */
function transactionDetails(id: string, dataset: MockDataset): MockResponse {
  const found = transactionsFor(dataset).find(
    (t) => t.id.toLowerCase() === id.toLowerCase(),
  );
  return found
    ? json(200, found)
    : json(404, { message: 'Transaction not found' });
}

// ---------------------------------------------------------------------------
// GET /files query semantics
// ---------------------------------------------------------------------------

const FILE_SORT_COLUMNS: readonly FileSortColumn[] = [
  'FileName',
  'LastProcessedAt',
  'RowCount',
  'Status',
  'ImportedCount',
];
const FILE_STATUSES: readonly FileStatus[] = [
  'Uploaded',
  'Processing',
  'Completed',
  'Failed',
];
const FILE_VISIBILITIES: readonly FileVisibility[] = [
  'Active',
  'Cancelled',
  'Both',
];
/** An ISO 8601 date or date-time, optionally with `Z` or an offset. */
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:\d{2})?$/;

/** Epoch ms of an ISO date-time query value, or null if it cannot be read. */
function instantOf(value: string): number | null {
  if (!ISO_DATE_TIME.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Sort key of a file for `column`; null = not known yet (sorts as the largest value). */
function fileSortKey(
  f: FileDetails,
  column: FileSortColumn,
): string | number | null {
  switch (column) {
    case 'FileName':
      return f.fileName.toLowerCase();
    case 'LastProcessedAt':
      return f.lastProcessedAt === null ? null : Date.parse(f.lastProcessedAt);
    case 'RowCount':
      return f.rowCount;
    case 'Status':
      return FILE_STATUSES.indexOf(f.status);
    case 'ImportedCount':
      return f.transactions.imported;
  }
}

/** Ascending comparison with nulls after every value. */
function compareNullable(
  a: string | number | null,
  b: string | number | null,
): number {
  if (a === null || b === null) {
    if (a === b) return 0;
    return a === null ? 1 : -1;
  }
  return compareKeys(a, b);
}

/** GET /files over `dataset` with query `params`. */
function listFiles(
  params: URLSearchParams,
  dataset: MockDataset,
): MockResponse {
  const errors: Record<string, string[]> = {};
  const fail = (name: string, message: string): void => {
    errors[name] = [message];
  };
  const get = (name: string): string | null => {
    const value = params.get(name);
    return value === null || value === '' ? null : value;
  };
  const notValid = (name: string, value: string): void =>
    fail(name, `The value '${value}' is not valid for ${name}.`);

  const pageRaw = get('page');
  const page = pageRaw === null ? 1 : Number(pageRaw);
  if (!Number.isInteger(page) || page < 1)
    fail('page', 'The page must be 1 or more.');

  const pageSizeRaw = get('pageSize');
  const pageSize = pageSizeRaw === null ? 20 : Number(pageSizeRaw);
  if (!PAGE_SIZES.includes(pageSize)) {
    fail('pageSize', 'The page size must be 5, 10, 20 or 50.');
  }

  const sortByRaw = get('sortBy') ?? 'LastProcessedAt';
  const sortBy = FILE_SORT_COLUMNS.find((c) => c === sortByRaw);
  if (!sortBy) notValid('sortBy', sortByRaw);

  const directionRaw = get('sortDirection');
  const direction: SortDirection | undefined =
    directionRaw === null
      ? sortBy === 'LastProcessedAt' || !sortBy
        ? 'Desc'
        : 'Asc'
      : SORT_DIRECTIONS.find((d) => d === directionRaw);
  if (!direction && directionRaw !== null)
    notValid('sortDirection', directionRaw);

  const statusRaw = get('status');
  const status =
    statusRaw === null ? null : FILE_STATUSES.find((s) => s === statusRaw);
  if (status === undefined && statusRaw !== null) notValid('status', statusRaw);

  const visibilityRaw = get('visibility');
  const visibility: FileVisibility | undefined =
    visibilityRaw === null
      ? 'Active'
      : FILE_VISIBILITIES.find((v) => v === visibilityRaw);
  if (!visibility && visibilityRaw !== null)
    notValid('visibility', visibilityRaw);

  const fromRaw = get('processedFrom');
  const from = fromRaw === null ? null : instantOf(fromRaw);
  if (fromRaw !== null && from === null) notValid('processedFrom', fromRaw);
  const toRaw = get('processedTo');
  const to = toRaw === null ? null : instantOf(toRaw);
  if (toRaw !== null && to === null) notValid('processedTo', toRaw);
  if (from !== null && to !== null && from > to) {
    fail(
      'processedTo',
      'The end of the process-date range must not be before its start.',
    );
  }

  if (Object.keys(errors).length > 0 || !sortBy || !direction || !visibility) {
    return validationProblem(errors);
  }

  // Matched literally, ignoring case (the back-end does not trim it either).
  const nameFilter = (params.get('fileName') ?? '').toLowerCase();

  const matching = filesFor(dataset).filter((f) => {
    const processed =
      f.lastProcessedAt === null ? null : Date.parse(f.lastProcessedAt);
    return (
      (!status || f.status === status) &&
      (nameFilter === '' || f.fileName.toLowerCase().includes(nameFilter)) &&
      (from === null || (processed !== null && processed >= from)) &&
      (to === null || (processed !== null && processed <= to)) &&
      (visibility === 'Both' ||
        (visibility === 'Cancelled' ? f.isCancelled : !f.isCancelled))
    );
  });

  const sign = direction === 'Desc' ? -1 : 1;
  const sorted = [...matching].sort(
    (a, b) =>
      sign *
      (compareNullable(fileSortKey(a, sortBy), fileSortKey(b, sortBy)) ||
        compareKeys(Date.parse(a.uploadedAt), Date.parse(b.uploadedAt)) ||
        compareKeys(a.id, b.id)),
  );

  return json(200, filePageOf(sorted.map(toFileListItem), { page, pageSize }));
}

/** The file with `id` in `dataset`, or undefined. */
function findFile(id: string, dataset: MockDataset): FileDetails | undefined {
  return (
    filesFor(dataset).find((f) => f.id.toLowerCase() === id.toLowerCase()) ??
    uploadedFiles.get(id.toLowerCase())
  );
}

/** GET /files/{id} over `dataset`. */
function fileDetails(id: string, dataset: MockDataset): MockResponse {
  const found = findFile(id, dataset);
  return found
    ? json(200, found)
    : json(404, { message: FILE_NOT_FOUND_MESSAGE });
}

/** GET /files/{id}/content over `dataset`: the original CSV, 410 once cancelled. */
function fileContent(id: string, dataset: MockDataset): MockResponse {
  const found = findFile(id, dataset);
  if (!found) return json(404, { message: FILE_NOT_FOUND_MESSAGE });
  if (!found.canDownload) {
    return json(410, { message: FILE_CONTENT_DISCARDED_MESSAGE });
  }
  return {
    status: 200,
    headers: {
      'content-type': 'text/csv',
      'content-disposition': contentDispositionFor(found.fileName),
    },
    body: fileContentFor(found),
  };
}

/** 401 for a request without an ACTIVE session (ended reason, else NotSignedIn). */
function unauthenticated(
  cookieHeader: string | null | undefined,
): MockResponse {
  return json(
    401,
    unauthenticatedBody(endedReasonFromCookie(cookieHeader) ?? 'NotSignedIn'),
  );
}

// ---------------------------------------------------------------------------
// POST /files (upload)
// ---------------------------------------------------------------------------

/**
 * Files uploaded through this process, by lower-case id. Served ONLY by
 * GET files/{id} (+ content) - never listed - so seeded counts never change.
 */
const uploadedFiles = new Map<string, FileDetails>();

/** `drop-once-` names whose first upload has already been dropped. */
const droppedOnce = new Set<string>();

const FILE_KINDS: readonly FileKind[] = ['BankTransactions'];
const MAX_FILE_NAME_LENGTH = 255;

/** The boundary of a multipart/form-data Content-Type, '' when missing, or null when not multipart. */
function multipartBoundary(
  contentType: string | null | undefined,
): string | null {
  if (!contentType) return null;
  const [mediaType, ...params] = contentType.split(';');
  if (mediaType.trim().toLowerCase() !== 'multipart/form-data') return null;
  for (const param of params) {
    const eq = param.indexOf('=');
    if (eq < 0) continue;
    if (param.slice(0, eq).trim().toLowerCase() !== 'boundary') continue;
    return param
      .slice(eq + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1');
  }
  return '';
}

/** The parameters of a `Content-Disposition` header value (names lower-cased). */
function dispositionParams(value: string): Map<string, string> {
  const params = new Map<string, string>();
  const pattern = /;\s*([^=;\s]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const raw =
      match[2] !== undefined
        ? match[2].replace(/\\(.)/g, '$1')
        : match[3].trim();
    params.set(match[1].toLowerCase(), raw);
  }
  return params;
}

/** Decodes an RFC 5987 `filename*` value (`UTF-8''name%20here`). */
function decodeExtendedValue(value: string): string {
  const quote = value.indexOf("''");
  const encoded = quote >= 0 ? value.slice(quote + 2) : value;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

/**
 * Parses a multipart/form-data body. Returns null when it cannot be read (no
 * opening boundary, a part without a header block, or no closing boundary).
 */
export function parseMultipart(
  body: Buffer,
  boundary: string,
): MultipartPart[] | null {
  const delimiter = Buffer.from(`--${boundary}`);
  const nextDelimiter = Buffer.from(`\r\n--${boundary}`);
  const start = body.indexOf(delimiter);
  if (start < 0) return null;
  const parts: MultipartPart[] = [];
  let pos = start + delimiter.length;
  for (;;) {
    if (body.subarray(pos, pos + 2).toString('latin1') === '--') return parts;
    if (body.subarray(pos, pos + 2).toString('latin1') !== '\r\n') return null;
    pos += 2;
    const headerEnd = body.indexOf('\r\n\r\n', pos, 'latin1');
    if (headerEnd < 0) return null;
    const headers = body
      .subarray(pos, headerEnd)
      .toString('utf8')
      .split('\r\n');
    const dataStart = headerEnd + 4;
    const dataEnd = body.indexOf(nextDelimiter, dataStart);
    if (dataEnd < 0) return null;

    const disposition = headers.find((h) =>
      h.toLowerCase().startsWith('content-disposition:'),
    );
    const params = dispositionParams(
      disposition ? disposition.slice(disposition.indexOf(':') + 1) : '',
    );
    const extended = params.get('filename*');
    parts.push({
      name: params.get('name') ?? null,
      filename:
        extended !== undefined
          ? decodeExtendedValue(extended)
          : (params.get('filename') ?? null),
      data: body.subarray(dataStart, dataEnd),
    });
    pos = dataEnd + nextDelimiter.length;
  }
}

/** True when `name` breaks the back-end's file-name rule. */
function isInvalidFileName(name: string): boolean {
  return (
    name.length === 0 ||
    name.length > MAX_FILE_NAME_LENGTH ||
    name.includes('..') ||
    /[\\/:]/.test(name)
  );
}

/** POST /files with the raw `upload` request, for the signed-in Importer. */
function uploadFile(upload: UploadRequest | undefined): MockResponse {
  const boundary = multipartBoundary(upload?.contentType);
  if (boundary === null) {
    return json(415, { message: NOT_MULTIPART_MESSAGE });
  }
  const body = Buffer.from(upload?.body ?? new Uint8Array());
  if (boundary === '' || boundary.length > 128) {
    return json(400, { message: UNREADABLE_UPLOAD_MESSAGE });
  }
  if (body.length > MOCK_UPLOAD_LIMIT_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return json(413, { message: FILE_TOO_LARGE_MESSAGE });
  }
  const parts = parseMultipart(body, boundary);
  if (parts === null) {
    return json(400, { message: UNREADABLE_UPLOAD_MESSAGE });
  }
  if (parts.some((p) => p.data.length > MOCK_UPLOAD_LIMIT_BYTES)) {
    return json(413, { message: FILE_TOO_LARGE_MESSAGE });
  }

  // A part with a filename is a file; a plain field named `file` is a file without a name.
  const isFile = (p: MultipartPart): boolean =>
    p.filename !== null || p.name === 'file';
  if (parts.filter(isFile).length > 1) {
    return json(400, { message: ONE_FILE_AT_A_TIME_MESSAGE });
  }

  const errors: Record<string, string[]> = {};
  const file = parts.find((p) => p.name === 'file');
  if (!file) errors.file = [FILE_REQUIRED_MESSAGE];
  const kindPart = parts.find((p) => p.name === 'kind');
  const kindRaw = kindPart
    ? kindPart.data.toString('utf8')
    : 'BankTransactions';
  const kind = FILE_KINDS.find((k) => k === kindRaw);
  if (!kind) errors.kind = [`The value '${kindRaw}' is not valid for kind.`];
  if (!file || !kind) return validationProblem(errors);

  const fileName = file.filename ?? '';
  if (isInvalidFileName(fileName)) {
    return json(400, { message: INVALID_FILE_NAME_MESSAGE });
  }
  if (!/\.csv$/i.test(fileName)) {
    return json(400, { message: NOT_CSV_MESSAGE });
  }

  if (fileName.startsWith(DROP_CONNECTION_ONCE_PREFIX)) {
    if (!droppedOnce.has(fileName)) {
      droppedOnce.add(fileName);
      return { status: 0, headers: {}, body: '', dropConnection: true };
    }
  } else if (fileName.startsWith(DROP_CONNECTION_PREFIX)) {
    return { status: 0, headers: {}, body: '', dropConnection: true };
  }

  const uploaded: UploadedFile = createUploadedFile({
    id: randomUUID(),
    fileName,
    kind,
    status: 'Uploaded',
    uploadedAt: new Date().toISOString(),
  });
  uploadedFiles.set(uploaded.id.toLowerCase(), uploadedFileDetails(uploaded));
  return json(201, uploaded);
}

const TRANSACTION_ID_PATH = /^\/transactions\/([^/]+)$/;
const FILE_ID_PATH = /^\/files\/([^/]+)(\/content)?$/;

/**
 * The mock back-end's answer for `method path` (path relative to the `/api` base,
 * e.g. `/auth/me`) given the request's `Cookie` header and, optionally, its query
 * string (`?a=1&b=2`, `a=1&b=2` or URLSearchParams). Usable from `page.route()`
 * handlers too, so browser-side and server-side mocks agree.
 *
 * POST /files needs `upload` (its Content-Type and raw body); without it the call
 * is treated as having no Content-Type (415). When the answer has
 * `dropConnection: true`, drop the connection instead of answering.
 */
export function respondFor(
  method: string,
  path: string,
  cookieHeader: string | null | undefined,
  query: URLSearchParams | string = '',
  upload?: UploadRequest,
): MockResponse {
  if (method === 'POST' && path === '/files') {
    const role = roleFromCookie(cookieHeader);
    if (!role) return unauthenticated(cookieHeader);
    if (role !== 'Importer') return json(403, forbiddenBody());
    return uploadFile(upload);
  }
  if (method === 'POST' && path === '/auth/sign-out') {
    return {
      status: 204,
      headers: { 'set-cookie': CLEAR_SESSION_COOKIE },
      body: '',
    };
  }
  if (method === 'GET' && path === '/auth/me') {
    const role = roleFromCookie(cookieHeader);
    if (role) return json(200, userInfoFor(role));
    return unauthenticated(cookieHeader);
  }

  if (method === 'GET') {
    const params =
      typeof query === 'string' ? new URLSearchParams(query) : query;
    const idMatch = TRANSACTION_ID_PATH.exec(path);
    const isTransactionDetails =
      idMatch !== null && UUID_PATTERN.test(idMatch[1]);
    const fileMatch = FILE_ID_PATH.exec(path);
    const isFilePath = fileMatch !== null && UUID_PATTERN.test(fileMatch[1]);
    if (
      path === '/transactions' ||
      path === '/files' ||
      path === '/dashboard/summary' ||
      isTransactionDetails ||
      isFilePath
    ) {
      if (!roleFromCookie(cookieHeader)) return unauthenticated(cookieHeader);
      const dataset = datasetFromCookie(cookieHeader);
      if (path === '/transactions') return listTransactions(params, dataset);
      if (path === '/files') return listFiles(params, dataset);
      if (path === '/dashboard/summary') {
        return json(200, summarizeFiles(filesFor(dataset)));
      }
      if (fileMatch) {
        return fileMatch[2]
          ? fileContent(fileMatch[1], dataset)
          : fileDetails(fileMatch[1], dataset);
      }
      if (idMatch) return transactionDetails(idMatch[1], dataset);
    }
  }

  return json(401, unauthenticatedBody('NotSignedIn'));
}

/** Starts the mock back-end on 127.0.0.1. Resolves with a function that stops it. */
export function startMockBackend(
  port: number = MOCK_BACKEND_PORT,
): Promise<() => Promise<void>> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const path = url.pathname.replace(/^\/api/, '');
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const { status, headers, body, dropConnection } = respondFor(
        req.method ?? 'GET',
        path,
        req.headers.cookie,
        url.searchParams,
        {
          contentType: req.headers['content-type'],
          body: Buffer.concat(chunks),
        },
      );
      if (dropConnection) {
        req.socket.destroy();
        return;
      }
      res.writeHead(status, headers);
      res.end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve(
        () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      );
    });
  });
}
