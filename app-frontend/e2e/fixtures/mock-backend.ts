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
 * Every other request -> 401 `unauthenticatedBody('NotSignedIn')`.
 *
 * Bodies come from the project-wide mock-data sources (never inlined here).
 */
import http from 'node:http';

import type {
  FileDetails,
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
  unauthenticatedBody,
  userInfoFor,
} from '../../src/mocks/data/identity';
import {
  pageOf,
  seedTransactionDetails,
  toListItem,
} from '../../src/mocks/data/transactions';

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
  return filesFor(dataset).find((f) => f.id.toLowerCase() === id.toLowerCase());
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

const TRANSACTION_ID_PATH = /^\/transactions\/([^/]+)$/;
const FILE_ID_PATH = /^\/files\/([^/]+)(\/content)?$/;

/**
 * The mock back-end's answer for `method path` (path relative to the `/api` base,
 * e.g. `/auth/me`) given the request's `Cookie` header and, optionally, its query
 * string (`?a=1&b=2`, `a=1&b=2` or URLSearchParams). Usable from `page.route()`
 * handlers too, so browser-side and server-side mocks agree.
 */
export function respondFor(
  method: string,
  path: string,
  cookieHeader: string | null | undefined,
  query: URLSearchParams | string = '',
): MockResponse {
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
    const { status, headers, body } = respondFor(
      req.method ?? 'GET',
      path,
      req.headers.cookie,
      url.searchParams,
    );
    res.writeHead(status, headers);
    res.end(body);
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
