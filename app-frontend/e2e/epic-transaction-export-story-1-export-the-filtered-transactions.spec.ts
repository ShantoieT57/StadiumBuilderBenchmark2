/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: app-frontend/src/components/transactions/TransactionsList.tsx
 * - Page Action: modify_existing
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked. This spec never contacts a live backend and uses no
 *   real credentials. Sign-in is faked by adding `txn_session=mockSessionValue('Approver')`
 *   with `context.addCookies()`, plus a per-test `mock-run` cookie (mockRunValue(testInfo)).
 * - Node side: the shared mock back-end (e2e/fixtures/mock-backend.ts, started by
 *   e2e/global-setup.ts, used by the Next server via BACKEND_URL) answers GET auth/me,
 *   GET transactions and GET transactions/export with real semantics: the list's filters
 *   and order over every page, `text/csv; charset=utf-8`, the server-built name in
 *   `Content-Disposition: attachment; filename=<n>; filename*=UTF-8''<n>`, and a body that
 *   is BOM + header + CR LF records (src/mocks/data/transactionExport.ts).
 * - Browser side: same-origin `/api/transactions...` calls pass through the Next `/api`
 *   proxy to that mock (observed, not intercepted). Only `/api/events` is fulfilled with
 *   `page.route()`, as an idle SSE stream (the mock emits no events).
 * - "Byte-for-byte as the server sent it" is checked by asking the mock back-end DIRECTLY
 *   (127.0.0.1:MOCK_BACKEND_PORT) for the same export with the same cookies and comparing
 *   its bytes to the saved download.
 * - Implementation pattern this assumes:
 *   - For an Approver, the Transactions screen shows a button named exactly "Export"
 *     (visible text, icon hidden from assistive tech) inside `<main>`, reachable with Tab.
 *   - Export is fetched FROM THE BROWSER through the API layer: one
 *     `GET /api/transactions/export` carrying the list's filter + sort params from the URL
 *     and never `page` / `pageSize`.
 *   - The Blob is saved unchanged via a temporary object URL + `<a download="<name>">`,
 *     where <name> is read from Content-Disposition (`filename*` preferred), so Playwright
 *     sees a `download` event whose suggested file name is the server's name.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Mock facts used (generated-docs/epics/transaction-export/mock-facts.md):
 *   - No filters: 30 rows, TXN-...-0030 first, TXN-...-0001 last.
 *   - status=Imported&sortBy=Amount&sortDirection=Asc: 15 rows, 0009 first, 0012 last.
 *   - status=Rejected: 5 rows, first row TXN-20260428-0028 with its rejection reason.
 *   - Expected names come from exportFileName(filter, { exportDate: exportDateOf() }).
 *
 * E2E spec for Epic transaction-export, Story 1: Export the filtered transactions.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { readFile } from 'node:fs/promises';

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type {
  APIRequestContext,
  BrowserContext,
  Download,
  Locator,
  Page,
  Request,
} from '@playwright/test';
import type { TransactionPage } from '../src/types/api-generated';
import {
  EXPORT_BOM,
  EXPORT_BOM_BYTES,
  EXPORT_CONTENT_TYPE,
  EXPORT_HEADER_LINE,
  EXPORT_LINE_ENDING,
  exportDateOf,
  exportFileName,
  exportRecordOf,
  type ExportNameFilter,
} from '../src/mocks/data/transactionExport';
import {
  seedTransactionDetails,
  seededTransactionReference,
} from '../src/mocks/data/transactions';
import {
  MOCK_BACKEND_PORT,
  MOCK_RUN_COOKIE,
  SESSION_COOKIE,
  mockRunValue,
  mockSessionValue,
} from './fixtures/mock-backend';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const IDLE_STREAM = 'retry: 600000\n: connected\n\n';
const EXPORT_PATH = '/api/transactions/export';
const MAX_TABS = 80;

async function signInAsApprover(
  page: Page,
  context: BrowserContext,
  baseURL: string,
  run: string,
): Promise<void> {
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: mockSessionValue('Approver'),
      url: baseURL,
      httpOnly: true,
      sameSite: 'Lax',
    },
    { name: MOCK_RUN_COOKIE, value: run, url: baseURL },
  ]);
  await page.route('**/api/events', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-cache' },
      body: IDLE_STREAM,
    }),
  );
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG_21_AA)
    .analyze();
  expect(violations).toEqual([]);
}

function exportButton(page: Page): Locator {
  return page
    .getByRole('main')
    .getByRole('button', { name: 'Export', exact: true });
}

/** Records the query of every GET the page makes to the export endpoint. */
function recordExportRequests(page: Page): URLSearchParams[] {
  const seen: URLSearchParams[] = [];
  page.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === EXPORT_PATH) {
      seen.push(url.searchParams);
    }
  });
  return seen;
}

function paramsOf(params: URLSearchParams): Record<string, string> {
  return Object.fromEntries(params.entries());
}

/** Presses Tab until `target` has focus (keyboard only, no clicks). */
async function tabTo(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  for (let i = 0; i < MAX_TABS; i += 1) {
    await page.keyboard.press('Tab');
    const focused = await target.evaluate(
      (element) => element === document.activeElement,
    );
    if (focused) return;
  }
  throw new Error(`Export was not reached within ${MAX_TABS} Tab presses`);
}

/** Starts Export by keyboard and returns the download with its saved bytes. */
async function exportByKeyboard(
  page: Page,
): Promise<{ download: Download; bytes: Buffer }> {
  await tabTo(page, exportButton(page));
  const downloadEvent = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  const download = await downloadEvent;
  const bytes = await readFile(await download.path());
  return { download, bytes };
}

/** The same export asked of the mock back-end directly, as raw bytes. */
async function serverExportBytes(
  request: APIRequestContext,
  query: string,
  run: string,
): Promise<Buffer> {
  const answer = await request.get(
    `http://127.0.0.1:${MOCK_BACKEND_PORT}${EXPORT_PATH}?${query}`,
    {
      headers: {
        cookie: `${SESSION_COOKIE}=${mockSessionValue('Approver')}; ${MOCK_RUN_COOKIE}=${run}`,
      },
    },
  );
  expect(answer.status()).toBe(200);
  return answer.body();
}

/** The data records of a CSV (BOM and header removed, no trailing empty line). */
function dataLines(bytes: Buffer): string[] {
  const text = bytes.toString('utf8');
  expect(text.startsWith(EXPORT_BOM)).toBe(true);
  const lines = text.slice(EXPORT_BOM.length).split(EXPORT_LINE_ENDING);
  expect(lines[0]).toBe(EXPORT_HEADER_LINE);
  expect(lines[lines.length - 1]).toBe('');
  return lines.slice(1, -1);
}

function referencesOf(lines: readonly string[]): string[] {
  return lines.map((line) => line.split(',')[0]);
}

/** Every reference the list shows for `query`, in its order, read through the /api proxy. */
async function listReferences(page: Page, query: string): Promise<string[]> {
  const separator = query === '' ? '' : '&';
  const answer = await page.request.get(
    `/api/transactions?${query}${separator}page=1&pageSize=50`,
  );
  expect(answer.status()).toBe(200);
  const list = (await answer.json()) as TransactionPage;
  return list.items.map((item) => item.reference);
}

/** The server's name for `filter`, today in SAST (built, never hard-coded). */
function expectedName(filter: ExportNameFilter): string {
  return exportFileName(filter, { exportDate: exportDateOf() });
}

test.describe('Epic transaction-export, Story 1: Export the filtered transactions', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-2
  test('with a filter and a sort applied, Export by keyboard downloads the server-named CSV of every matching row from all pages in the list order', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const listQuery = 'status=Imported&sortBy=Amount&sortDirection=Asc';
    await signInAsApprover(
      page,
      context,
      baseURL ?? 'http://localhost:3000',
      mockRunValue(testInfo),
    );
    const exportRequests = recordExportRequests(page);

    // Five rows per page: the 15 Imported rows span three pages.
    await page.goto(`/transactions?${listQuery}&pageSize=5`);
    const main = page.getByRole('main');
    await expect(main).toContainText(seededTransactionReference(9));
    await expect(main).not.toContainText(seededTransactionReference(12));
    await expect(exportButton(page)).toBeVisible();
    await expectNoAxeViolations(page);

    const { download, bytes } = await exportByKeyboard(page);

    expect(download.suggestedFilename()).toBe(
      expectedName({ status: 'Imported' }),
    );
    expect(download.suggestedFilename()).toMatch(/\.csv$/);

    // One request, with exactly the list's filter and sort, without paging.
    expect(exportRequests.map(paramsOf)).toEqual([
      { status: 'Imported', sortBy: 'Amount', sortDirection: 'Asc' },
    ]);

    // Exactly the matching rows from every page, in the list's order.
    const references = referencesOf(dataLines(bytes));
    expect(references).toEqual(await listReferences(page, listQuery));
    expect(references[0]).toBe(seededTransactionReference(9));
    expect(references[references.length - 1]).toBe(
      seededTransactionReference(12),
    );
    expect(new Set(references)).toEqual(
      new Set(
        seedTransactionDetails()
          .filter((t) => t.status === 'Imported')
          .map((t) => t.reference),
      ),
    );

    // The user stays on the filtered list; the file's contents are not shown.
    await expect(page).toHaveURL(/\/transactions\?/);
    await expect(main).not.toContainText(EXPORT_HEADER_LINE);
    await expectNoAxeViolations(page);
  });

  // AC-3
  test('with no filters, Export downloads every transaction as transactions_<date>.csv', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    await signInAsApprover(
      page,
      context,
      baseURL ?? 'http://localhost:3000',
      mockRunValue(testInfo),
    );
    const exportRequests = recordExportRequests(page);
    await page.goto('/transactions');
    await expect(page.getByRole('main')).toContainText(
      seededTransactionReference(30),
    );

    const { download, bytes } = await exportByKeyboard(page);

    expect(download.suggestedFilename()).toBe(expectedName({}));

    // One request with no filter and no paging parameters (the sort may be explicit).
    expect(
      exportRequests.map((params) =>
        Object.fromEntries(
          [...params.entries()].filter(
            ([name]) => name !== 'sortBy' && name !== 'sortDirection',
          ),
        ),
      ),
    ).toEqual([{}]);

    // Every seeded transaction, newest first, as the list orders them.
    const references = referencesOf(dataLines(bytes));
    expect(references).toEqual(await listReferences(page, ''));
    expect(new Set(references)).toEqual(
      new Set(seedTransactionDetails().map((t) => t.reference)),
    );
    expect(references[0]).toBe(seededTransactionReference(30));
    expect(references[references.length - 1]).toBe(
      seededTransactionReference(1),
    );
  });

  // AC-4
  test('the downloaded file has the list columns plus the review columns and is byte-for-byte what the server sent, BOM included', async ({
    page,
    context,
    baseURL,
    request,
  }, testInfo) => {
    const run = mockRunValue(testInfo);
    const listQuery = 'status=Rejected';
    await signInAsApprover(
      page,
      context,
      baseURL ?? 'http://localhost:3000',
      run,
    );
    await page.goto(`/transactions?${listQuery}`);
    await expect(page.getByRole('main')).toContainText(
      seededTransactionReference(28),
    );

    const exportResponse = page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' &&
        new URL(r.url()).pathname === EXPORT_PATH,
    );
    const { download, bytes } = await exportByKeyboard(page);
    const answer = await exportResponse;

    // The proxy passed the server's type and name through.
    expect(answer.status()).toBe(200);
    expect(answer.headers()['content-type']).toBe(EXPORT_CONTENT_TYPE);
    expect(download.suggestedFilename()).toBe(
      expectedName({ status: 'Rejected' }),
    );

    // Byte-for-byte what the server sends for the same query.
    const serverBytes = await serverExportBytes(request, listQuery, run);
    expect(bytes.equals(serverBytes)).toBe(true);

    // UTF-8 with the byte-order mark, then the header row.
    expect([...bytes.subarray(0, 3)]).toEqual([...EXPORT_BOM_BYTES]);
    const text = bytes.toString('utf8').slice(EXPORT_BOM.length);
    expect(text.split(EXPORT_LINE_ENDING)[0]).toBe(
      'Reference,Transaction Date,Account Number,Description,Amount,Currency,Type,Status,File,Rejection Reason,Last Changed By,Last Changed On',
    );

    // The first Rejected row carries its reason and who changed it last.
    const rejected28 = seedTransactionDetails().find(
      (t) => t.reference === seededTransactionReference(28),
    );
    if (!rejected28) {
      throw new Error('Seeded transaction 28 is missing from the mock data');
    }
    expect(dataLines(bytes)[0] + EXPORT_LINE_ENDING).toBe(
      exportRecordOf(rejected28),
    );
  });
});
