/**
 * Story Metadata:
 * - Route: /dashboard
 * - Target File: app-frontend/src/app/(authenticated)/dashboard/page.tsx
 * - Page Action: modify_existing
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked. This spec never contacts a live backend and uses no
 *   real credentials. Sign-in is faked by seeding `txn_session=mockSessionValue(role)` with
 *   `context.addCookies()`.
 * - Node side: the shared stateless mock back-end (e2e/fixtures/mock-backend.ts, started by
 *   e2e/global-setup.ts, used by the Next server via BACKEND_URL). It answers GET auth/me
 *   and GET files with real paging / sort / visibility semantics over the seeded files
 *   (src/mocks/data/files.ts). The `mock-dataset=many` cookie switches to 50 active files.
 * - Browser side: same-origin `/api/files` calls pass through the Next /api proxy to that
 *   mock, so they are NOT intercepted here. Only `/api/events` is fulfilled with
 *   `page.route()` as an idle SSE stream.
 * - Implementation pattern this assumes:
 *   - The list calls GET /api/files FROM THE BROWSER (client component via `getFiles`), so
 *     the `mock-dataset` cookie reaches the mock through the proxy. sortBy / sortDirection /
 *     page / pageSize live in the URL search params with the API's names (defaults
 *     omitted), so reload and Back restore the view.
 *   - Desktop (>= 768px): a `table`. Each file name cell is a `link` whose accessible name
 *     is the file name alone (e.g. `april-batch-1.csv`). Each column header is a
 *     `columnheader` holding a sort `button` ("File name", "Last processed", "Rows",
 *     "Status", "Imported"). A non-default column sorts ascending on first click and
 *     toggles on the next.
 *   - Paging: buttons named "Next page" and "Previous page", and text "Page X of Y".
 *   - Page size: a combobox (shadcn Select) whose accessible name contains "per page",
 *     with options named "5", "10", "20" and "50".
 *   - Narrow (< 768px): each file is a `listitem` holding the file name, status in words,
 *     the Imported count next to the word "Imported", and the last processed local time
 *     (`yyyy-MM-dd HH:mm`, or "Not processed yet"), plus a details `link` whose name
 *     mentions "details" or the file name, pointing at `/dashboard/files/<id>`.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Seeded-dataset facts used below (generated-docs/epics/file-dashboard-and-details/
 * mock-facts.md): 9 active files; default order and FileName Asc order listed below;
 * april-batch-1.csv is Completed, 9 Imported, processed 2026-04-30 18:05 (+02:00).
 * `many`: the 9 active seeded files then bulk-import-41 .. bulk-import-01 (newest first).
 *
 * E2E spec for Epic file-dashboard-and-details, Story 1: Dashboard file list with sorting,
 * paging and phone layout. These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type { BrowserContext, Page } from '@playwright/test';
import type { UserRole } from '../src/types/api-generated';
import { MOCK_DATASET_COOKIE, mockSessionValue } from './fixtures/mock-backend';
import { DASHBOARD_FILE_IDS } from '../src/mocks/data/files';

// Seeded times are at +02:00; pin the browser zone so local times are deterministic.
test.use({ timezoneId: 'Africa/Johannesburg' });

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Default view: LastProcessedAt Desc (not-yet-processed first). */
const DEFAULT_ORDER = [
  'may-payroll.csv',
  'may-suppliers.csv',
  'bank-export-copy.csv',
  'april-invalid-rows.csv',
  'april-batch-2.csv',
  'april-batch-1.csv',
  'empty-reference-rows.csv',
  'Q1-Adjustments.csv',
  'march-statement-rerun.csv',
];

const BY_NAME_ASC = [
  'april-batch-1.csv',
  'april-batch-2.csv',
  'april-invalid-rows.csv',
  'bank-export-copy.csv',
  'empty-reference-rows.csv',
  'march-statement-rerun.csv',
  'may-payroll.csv',
  'may-suppliers.csv',
  'Q1-Adjustments.csv',
];
const BY_NAME_DESC = [...BY_NAME_ASC].reverse();

/** bulk-import-NN.csv names from `from` down to `to`, inclusive. */
function bulk(from: number, to: number): string[] {
  return Array.from(
    { length: from - to + 1 },
    (_, i) => `bulk-import-${String(from - i).padStart(2, '0')}.csv`,
  );
}

/** The `many` dataset in default order (50 files). */
const MANY_ORDER = [...DEFAULT_ORDER, ...bulk(41, 1)];

async function signInAs(
  page: Page,
  context: BrowserContext,
  role: UserRole,
  baseURL: string,
): Promise<void> {
  await context.addCookies([
    {
      name: 'txn_session',
      value: mockSessionValue(role),
      url: baseURL,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  // An idle SSE stream with a long retry, so EventSource does not hammer reconnects.
  await page.route('**/api/events', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-cache' },
      body: 'retry: 600000\n: connected\n\n',
    }),
  );
}

/**
 * The file-name links shown in the desktop table, in display order. An Importer
 * also sees "Correct <file name>" shortcut links, which are not file names.
 */
function tableFileNames(page: Page) {
  return page
    .getByRole('table')
    .getByRole('link', { name: /^(?!Correct ).+\.csv$/i });
}

async function choosePageSize(page: Page, size: string): Promise<void> {
  await page.getByRole('combobox', { name: /per page/i }).click();
  await page.getByRole('option', { name: size, exact: true }).click();
}

test.describe('Epic file-dashboard-and-details, Story 1: Dashboard file list with sorting, paging and phone layout', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-2
  test('opens most recently processed first, sorts by a column header, keeps the sort while paging, and restores it on reload and Back', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAs(
      page,
      context,
      'Approver',
      baseURL ?? 'http://localhost:3000',
    );
    await page.goto('/dashboard');

    // Most recently processed first; the defaults stay out of the address bar.
    const names = tableFileNames(page);
    await expect(names).toHaveText(DEFAULT_ORDER);
    await expect(page).not.toHaveURL(/sortBy=/);

    // Accessibility: scan the loaded desktop list.
    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_21_AA)
      .analyze();
    expect(violations).toEqual([]);

    // Use 5 per page so the 9 seeded files span two pages.
    await choosePageSize(page, '5');
    await expect(names).toHaveText(DEFAULT_ORDER.slice(0, 5));

    // First click on File name sorts ascending.
    const nameSort = page
      .getByRole('table')
      .getByRole('columnheader', { name: /file name/i })
      .getByRole('button');
    await nameSort.click();
    await expect(page).toHaveURL(/sortBy=FileName/);
    await expect(names).toHaveText(BY_NAME_ASC.slice(0, 5));

    // The sort stays while paging forward and back.
    await page.getByRole('button', { name: /next page/i }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page).toHaveURL(/sortBy=FileName/);
    await expect(names).toHaveText(BY_NAME_ASC.slice(5));

    await page.getByRole('button', { name: /previous page/i }).click();
    await expect(names).toHaveText(BY_NAME_ASC.slice(0, 5));
    await expect(page).toHaveURL(/sortBy=FileName/);

    // The second click toggles to descending.
    await nameSort.click();
    await expect(page).toHaveURL(/sortDirection=Desc/);
    await expect(names).toHaveText(BY_NAME_DESC.slice(0, 5));

    await page.getByRole('button', { name: /next page/i }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(names).toHaveText(BY_NAME_DESC.slice(5));

    // Reload restores the same sort and page.
    await page.reload();
    await expect(page).toHaveURL(/sortBy=FileName/);
    await expect(page).toHaveURL(/sortDirection=Desc/);
    await expect(page).toHaveURL(/page=2/);
    await expect(names).toHaveText(BY_NAME_DESC.slice(5));

    // Leave the list, then Back returns to the same sort and page.
    await page
      .getByRole('navigation')
      .getByRole('link', { name: 'Transactions' })
      .click();
    await expect(page).toHaveURL(/\/transactions/);
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard\?.*sortBy=FileName/);
    await expect(page).toHaveURL(/page=2/);
    await expect(names).toHaveText(BY_NAME_DESC.slice(5));
  });

  // AC-3
  test('shows 20 per page by default, Previous / Next move between pages, and choosing 5, 10, 20 or 50 changes the page size and returns to page 1', async ({
    page,
    context,
    baseURL,
  }) => {
    const url = baseURL ?? 'http://localhost:3000';
    await signInAs(page, context, 'Importer', url);
    await context.addCookies([
      { name: MOCK_DATASET_COOKIE, value: 'many', url },
    ]);
    await page.goto('/dashboard');

    const names = tableFileNames(page);
    await expect(names).toHaveText(MANY_ORDER.slice(0, 20));
    await expect(page.getByText(/page 1 of 3/i)).toBeVisible();

    await page.getByRole('button', { name: /next page/i }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(names).toHaveText(MANY_ORDER.slice(20, 40));
    await expect(page.getByText(/page 2 of 3/i)).toBeVisible();

    await page.getByRole('button', { name: /next page/i }).click();
    await expect(page).toHaveURL(/page=3/);
    await expect(names).toHaveText(MANY_ORDER.slice(40));

    await page.getByRole('button', { name: /previous page/i }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(names).toHaveText(MANY_ORDER.slice(20, 40));

    // Changing the size from page 2 returns to page 1.
    await choosePageSize(page, '5');
    await expect(page).toHaveURL(/pageSize=5/);
    await expect(page).not.toHaveURL(/[?&]page=2/);
    await expect(names).toHaveText(MANY_ORDER.slice(0, 5));

    await choosePageSize(page, '10');
    await expect(page).toHaveURL(/pageSize=10/);
    await expect(names).toHaveText(MANY_ORDER.slice(0, 10));

    await choosePageSize(page, '50');
    await expect(page).toHaveURL(/pageSize=50/);
    await expect(names).toHaveText(MANY_ORDER);

    // Back to the default size: 20 files, page 1, and the default leaves the URL.
    await choosePageSize(page, '20');
    await expect(page).not.toHaveURL(/pageSize=/);
    await expect(names).toHaveText(MANY_ORDER.slice(0, 20));
  });

  // AC-5
  test('at 360px each file shows name, status, Imported count and last processed, its details link is keyboard reachable, and there is no horizontal scroll', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await signInAs(
      page,
      context,
      'Approver',
      baseURL ?? 'http://localhost:3000',
    );
    await page.goto('/dashboard');

    // april-batch-1.csv: Completed, 9 Imported, processed 2026-04-30 18:05 local.
    const row = page
      .getByRole('listitem')
      .filter({ hasText: 'april-batch-1.csv' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Completed');
    // Card text is concatenated textContent ("Imported: 9Details ..."), so the
    // count's end is checked with "no further digit" rather than a word boundary.
    await expect(row).toContainText(/Imported\D{0,3}9(?!\d)|\b9\s*Imported/i);
    await expect(row).toContainText('2026-04-30 18:05');

    // An unprocessed file says so in words.
    const unprocessed = page
      .getByRole('listitem')
      .filter({ hasText: 'may-payroll.csv' });
    await expect(unprocessed).toContainText('Not processed yet');
    await expect(unprocessed).toContainText('Uploaded');

    // No horizontal scroll at phone width.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    // Accessibility: scan the phone layout.
    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_21_AA)
      .analyze();
    expect(violations).toEqual([]);

    // The details link sits inside the viewport and works from the keyboard.
    const details = row.getByRole('link', {
      name: /details|april-batch-1\.csv/i,
    });
    await expect(details).toBeVisible();
    const box = await details.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);

    await details.focus();
    await expect(details).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/files/${DASHBOARD_FILE_IDS.aprilBatch1}$`),
    );
  });
});
