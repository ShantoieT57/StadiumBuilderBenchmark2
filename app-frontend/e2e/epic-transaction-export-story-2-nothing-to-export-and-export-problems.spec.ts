/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: app-frontend/src/components/transactions/TransactionsList.tsx
 * - Page Action: modify_existing
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked. This spec never contacts a live backend and uses no
 *   real credentials. Sign-in is faked by adding `txn_session=mockSessionValue(<Role>)`
 *   with `context.addCookies()`.
 * - Node side: the shared mock back-end (e2e/fixtures/mock-backend.ts, started by
 *   e2e/global-setup.ts, used by the Next server via BACKEND_URL). It answers GET auth/me,
 *   GET transactions, POST transactions/{id}/approve and GET transactions/export with real
 *   semantics (see generated-docs/epics/transaction-export/mock-facts.md):
 *     - nothing matches -> 409 `{ message }` (NO_MATCHES_TO_EXPORT_MESSAGE with filters,
 *       NO_TRANSACTIONS_TO_EXPORT_MESSAGE without);
 *     - an ENDED session (`endedSessionValue('Approver', 'SessionExpired')`) -> 401 with
 *       reason SessionExpired;
 *     - otherwise 200 CSV with `Content-Disposition` naming the file.
 * - Every test sets its own `mock-run` cookie (MOCK_RUN_COOKIE = mockRunValue(testInfo)),
 *   so its approvals are seen only by its own later reads and exports (parallel-safe).
 * - "The data changed after the list loaded" (AC-2) approves the 6 Imported april-batch-2
 *   rows by calling the mock back-end DIRECTLY (127.0.0.1:MOCK_BACKEND_PORT) with the same
 *   session + run cookies, standing in for another tab. The UI's export then gets the real
 *   409.
 * - `mock-dataset=empty` (MOCK_DATASET_COOKIE) gives a dataset with no transactions (AC-5).
 * - Browser side: same-origin `/api/...` calls pass through the Next `/api` proxy to that
 *   mock (observed, not intercepted). `page.route()` fulfils `/api/events` as an idle SSE
 *   stream (the mock emits no events) and, in AC-5 only, answers ONE export with a 503 to
 *   stand in for a server failure.
 * - Implementation pattern this assumes:
 *   - The export is ONE `GET /api/transactions/export` made FROM THE BROWSER, carrying the
 *     list's filter (and sort) params and no `page` / `pageSize`.
 *   - For an Approver, the Transactions screen has a button named exactly "Export". When it
 *     is unavailable it keeps `aria-disabled="true"` (still focusable) and selecting it
 *     sends nothing.
 *   - No matches in the loaded list: a visible note beside Export with the server's
 *     wording (e.g. "There are no transactions yet, so there is nothing to export.").
 *   - A 409 from the export: no download; the response `message` verbatim in an inline
 *     `role=alert` beside Export (NOT a toast in the "Notifications" region); Export stays
 *     unavailable until a filter in the URL changes.
 *   - A 5xx / network failure: an inline `role=alert` beside Export reading "The export
 *     could not be downloaded." with a button "Try again" that repeats the same request.
 *   - A 401: the central client handler goes to `/sign-in` with the reason (the sign-in
 *     screen's SessionExpired message mentions "60 minutes"); no export problem is shown.
 *   - The "Active filters" list has a "Remove Status filter" button (transactions-list).
 *   - Below 768px the Export row (button + note / problem) wraps inside the screen width.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Mock facts used: Imported + april-batch-2 -> rows 30, 25, 18, 15, 13, 3 (newest first);
 * april-batch-2 alone -> 12 rows, file name `transactions_file-april-batch-2_<date>.csv`;
 * Imported alone -> `transactions_Imported_<date>.csv`. `<date>` comes from
 * `exportDateOf()`, never hard-coded.
 *
 * E2E spec for Epic transaction-export, Story 2: Nothing to export, and export problems.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type {
  APIRequestContext,
  BrowserContext,
  Locator,
  Page,
} from '@playwright/test';
// Shared project-wide mock data, imported relatively (not @/) for the Playwright runtime.
import {
  NO_MATCHES_TO_EXPORT_MESSAGE,
  NO_TRANSACTIONS_TO_EXPORT_MESSAGE,
  exportDateOf,
  exportFileName,
} from '../src/mocks/data/transactionExport';
import {
  seededTransactionId,
  seededTransactionReference,
} from '../src/mocks/data/transactions';
import { SEEDED_FILE_IDS } from '../src/mocks/data/files';
import {
  MOCK_BACKEND_PORT,
  MOCK_DATASET_COOKIE,
  MOCK_RUN_COOKIE,
  SESSION_COOKIE,
  endedSessionValue,
  mockRunValue,
  mockSessionValue,
} from './fixtures/mock-backend';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const IDLE_STREAM = 'retry: 600000\n: connected\n\n';
const PHONE_WIDTH = 360;
const SIGN_IN_URL = /\/sign-in(\?.*)?$/;
const EXPORT_PATH = '/api/transactions/export';
const EXPORT_FAILED = 'The export could not be downloaded.';
const BATCH_2 = SEEDED_FILE_IDS.aprilBatch2;
const BATCH_2_FILE_NAME = 'april-batch-2.csv';
const REFERENCE = /^TXN-\d{8}-\d{4}$/;

/** The Imported transactions of april-batch-2, newest first. */
const IMPORTED_BATCH_2 = [30, 25, 18, 15, 13, 3];

async function setSession(
  context: BrowserContext,
  baseURL: string,
  value: string,
): Promise<void> {
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value,
      url: baseURL,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

async function signInAsApprover(
  page: Page,
  context: BrowserContext,
  baseURL: string,
  run: string,
): Promise<void> {
  await setSession(context, baseURL, mockSessionValue('Approver'));
  // Keeps this test's changes for its own later reads only (parallel-safe).
  await context.addCookies([
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
  return page.getByRole('button', { name: 'Export', exact: true });
}

/** The inline export problem (role alert) carrying `text`. */
function exportProblem(page: Page, text: string): Locator {
  return page.getByRole('alert').filter({ hasText: text });
}

/** The references shown in the desktop table, in display order. */
function tableReferences(page: Page): Locator {
  return page.getByRole('table').getByText(REFERENCE);
}

/** Records the query of every export request the page makes, as a plain object. */
function recordExportRequests(page: Page): Record<string, string>[] {
  const seen: Record<string, string>[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === EXPORT_PATH) {
      seen.push(Object.fromEntries(url.searchParams));
    }
  });
  return seen;
}

/** Records the suggested name of every download the page starts. */
function recordDownloads(page: Page): string[] {
  const names: string[] = [];
  page.on('download', (download) => names.push(download.suggestedFilename()));
  return names;
}

function isExportResponse(url: string): boolean {
  return new URL(url).pathname === EXPORT_PATH;
}

/** Approves seeded transaction `n` directly at the mock, as another tab would. */
async function approveElsewhere(
  request: APIRequestContext,
  n: number,
  run: string,
): Promise<void> {
  const answer = await request.post(
    `http://127.0.0.1:${MOCK_BACKEND_PORT}/api/transactions/${seededTransactionId(n)}/approve`,
    {
      headers: {
        cookie: `${SESSION_COOKIE}=${mockSessionValue('Approver')}; ${MOCK_RUN_COOKIE}=${run}`,
      },
    },
  );
  expect(answer.status()).toBe(200);
}

/** How far the page scrolls sideways (0 = no horizontal scroll). */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

/** Asserts `target` lies fully inside a `width`-wide screen. */
async function expectInsideScreen(
  target: Locator,
  width: number,
): Promise<void> {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? width + 1)).toBeLessThanOrEqual(width);
}

test.describe('Epic transaction-export, Story 2: Nothing to export, and export problems', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-2
  test('when the list showed matches but the export finds nothing, no file downloads and the server message stays beside Export until the filters change', async ({
    page,
    context,
    baseURL,
    request,
  }, testInfo) => {
    const run = mockRunValue(testInfo);
    await signInAsApprover(
      page,
      context,
      baseURL ?? 'http://localhost:3000',
      run,
    );
    const exportRequests = recordExportRequests(page);
    const downloads = recordDownloads(page);

    await page.goto(`/transactions?status=Imported&fileId=${BATCH_2}`);
    await expect(tableReferences(page)).toHaveText(
      IMPORTED_BATCH_2.map(seededTransactionReference),
    );
    const exportControl = exportButton(page);
    await expect(exportControl).not.toHaveAttribute('aria-disabled', 'true');

    // Another tab approves every matching transaction; this list still shows 6.
    for (const n of IMPORTED_BATCH_2) {
      await approveElsewhere(request, n, run);
    }

    const conflict = page.waitForResponse((r) => isExportResponse(r.url()));
    await exportControl.click();
    expect((await conflict).status()).toBe(409);

    // The server's explanation beside Export, not as a toast; no file.
    const problem = exportProblem(page, NO_MATCHES_TO_EXPORT_MESSAGE);
    await expect(problem).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Notifications' })
        .getByText(NO_MATCHES_TO_EXPORT_MESSAGE),
    ).toHaveCount(0);
    expect(downloads).toEqual([]);
    expect(exportRequests).toEqual([{ status: 'Imported', fileId: BATCH_2 }]);

    // Accessibility: the list with the nothing-to-export problem showing.
    await expectNoAxeViolations(page);

    // Export stays unavailable: selecting it again sends nothing.
    await expect(exportControl).toHaveAttribute('aria-disabled', 'true');
    await exportControl.focus();
    await page.keyboard.press('Enter');
    await expect(problem).toBeVisible();
    expect(exportRequests).toEqual([{ status: 'Imported', fileId: BATCH_2 }]);

    // Changing the filters clears it, and Export works again for the new filters.
    await page
      .getByRole('list', { name: 'Active filters' })
      .getByRole('button', { name: 'Remove Status filter' })
      .click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(problem).toBeHidden();
    await expect(exportControl).not.toHaveAttribute('aria-disabled', 'true');

    const download = page.waitForEvent('download');
    await exportControl.click();
    expect((await download).suggestedFilename()).toBe(
      exportFileName(
        { fileId: BATCH_2 },
        { exportDate: exportDateOf(), fileName: BATCH_2_FILE_NAME },
      ),
    );
    expect(exportRequests).toEqual([
      { status: 'Imported', fileId: BATCH_2 },
      { fileId: BATCH_2 },
    ]);
  });

  // AC-4
  test('when the session has ended, Export goes to sign-in with the matching explanation and leaves no problem message behind', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const base = baseURL ?? 'http://localhost:3000';
    await signInAsApprover(page, context, base, mockRunValue(testInfo));
    const downloads = recordDownloads(page);

    await page.goto('/transactions?status=Imported');
    await expect(
      page.getByRole('table').getByText(seededTransactionReference(30), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(exportButton(page)).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );

    // The back-end ends the session for inactivity; the export is answered 401.
    await setSession(
      context,
      base,
      endedSessionValue('Approver', 'SessionExpired'),
    );
    const rejected = page.waitForResponse((r) => isExportResponse(r.url()));
    await exportButton(page).click();
    expect((await rejected).status()).toBe(401);

    await expect(page).toHaveURL(SIGN_IN_URL);
    await expect(page.getByText(/60 minutes/i)).toBeVisible();
    await expect(page.getByText(EXPORT_FAILED)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(
      0,
    );
    expect(downloads).toEqual([]);

    // Signed in again, Transactions shows no leftover export problem.
    await setSession(context, base, mockSessionValue('Approver'));
    await page.goto('/transactions?status=Imported');
    await expect(exportButton(page)).toBeVisible();
    await expect(exportButton(page)).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(page.getByText(EXPORT_FAILED)).toHaveCount(0);
  });

  // AC-5
  test('at 360px Export with its note or problem message fits without sideways scrolling, and exporting (with Try again) works the same', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const base = baseURL ?? 'http://localhost:3000';
    await page.setViewportSize({ width: PHONE_WIDTH, height: 800 });
    await signInAsApprover(page, context, base, mockRunValue(testInfo));

    // --- No transactions at all: Export unavailable with its note beside it ---
    await context.addCookies([
      { name: MOCK_DATASET_COOKIE, value: 'empty', url: base },
    ]);
    await page.goto('/transactions');
    const exportControl = exportButton(page);
    await expectInsideScreen(exportControl, PHONE_WIDTH);
    await expect(exportControl).toHaveAttribute('aria-disabled', 'true');
    const note = page.getByText(NO_TRANSACTIONS_TO_EXPORT_MESSAGE, {
      exact: true,
    });
    await expectInsideScreen(note, PHONE_WIDTH);
    expect(await horizontalOverflow(page)).toBe(0);

    // Accessibility: the nothing-to-export note at phone width.
    await expectNoAxeViolations(page);

    // --- Seeded data: a failed export shows the problem with Try again, then works ---
    await context.addCookies([
      { name: MOCK_DATASET_COOKIE, value: 'seeded', url: base },
    ]);
    const exportRequests = recordExportRequests(page);
    const failOnce = (url: URL): boolean => url.pathname === EXPORT_PATH;
    await page.route(failOnce, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Service unavailable' }),
      }),
    );

    await page.goto('/transactions?status=Imported');
    await expect(exportControl).not.toHaveAttribute('aria-disabled', 'true');
    await expectInsideScreen(exportControl, PHONE_WIDTH);

    const failed = page.waitForResponse((r) => isExportResponse(r.url()));
    await exportControl.click();
    expect((await failed).status()).toBe(503);

    const problem = exportProblem(page, EXPORT_FAILED);
    await expectInsideScreen(problem, PHONE_WIDTH);
    const tryAgain = problem.getByRole('button', { name: 'Try again' });
    await expectInsideScreen(tryAgain, PHONE_WIDTH);
    expect(await horizontalOverflow(page)).toBe(0);

    // Accessibility: the export problem at phone width.
    await expectNoAxeViolations(page);

    // The server is back: Try again repeats the same export and the file downloads.
    await page.unroute(failOnce);
    const download = page.waitForEvent('download');
    await tryAgain.click();
    expect((await download).suggestedFilename()).toBe(
      exportFileName({ status: 'Imported' }, { exportDate: exportDateOf() }),
    );
    await expect(problem).toBeHidden();
    expect(exportRequests).toEqual([
      { status: 'Imported' },
      { status: 'Imported' },
    ]);
    expect(await horizontalOverflow(page)).toBe(0);
  });
});
