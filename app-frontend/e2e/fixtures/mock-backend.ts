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
 *   - GET files               the seeded files (src/mocks/data/files.ts `seedFiles()`) as a FilePage.
 *
 * Dataset override (per test, parallel-safe): set a `mock-dataset` cookie on the
 * browser context, e.g.
 *   context.addCookies([{ name: MOCK_DATASET_COOKIE, value: 'empty', url: baseURL }])
 * The /api proxy forwards the whole Cookie header, so browser-side calls carry it.
 *   - absent | `seeded`   the 30 seeded transactions across 2 files (default)
 *   - `empty`             no transactions and no files; GET transactions answers
 *                         hasAnyTransactions: false ("No transactions yet")
 * Next.js SERVER-side fetches that forward only `txn_session` (e.g. GET auth/me) never
 * carry it, so the override applies to calls made through the browser's /api proxy.
 *
 * Every other request -> 401 `unauthenticatedBody('NotSignedIn')`.
 *
 * Bodies come from the project-wide mock-data sources (never inlined here).
 */
import http from 'node:http';

import type {
  FileListItem,
  SortDirection,
  TransactionDetails,
  TransactionSortColumn,
  TransactionStatus,
  UnauthenticatedReason,
  UserRole,
  ValidationProblem,
} from '../../src/types/api-generated';
import { filePageOf, seedFiles } from '../../src/mocks/data/files';
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
export type MockDataset = 'seeded' | 'empty';

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
  return cookieValue(cookieHeader, MOCK_DATASET_COOKIE) === 'empty'
    ? 'empty'
    : 'seeded';
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

function filesFor(dataset: MockDataset): FileListItem[] {
  return dataset === 'empty' ? [] : seedFiles();
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

/** GET /files over `dataset` (paging honoured, filters and sort not modelled). */
function listFiles(
  params: URLSearchParams,
  dataset: MockDataset,
): MockResponse {
  const page = Number(params.get('page') ?? 1) || 1;
  const pageSize = Number(params.get('pageSize') ?? 20) || 20;
  return json(200, filePageOf(filesFor(dataset), { page, pageSize }));
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
    if (path === '/transactions' || path === '/files' || isTransactionDetails) {
      if (!roleFromCookie(cookieHeader)) return unauthenticated(cookieHeader);
      const dataset = datasetFromCookie(cookieHeader);
      if (path === '/transactions') return listTransactions(params, dataset);
      if (path === '/files') return listFiles(params, dataset);
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
