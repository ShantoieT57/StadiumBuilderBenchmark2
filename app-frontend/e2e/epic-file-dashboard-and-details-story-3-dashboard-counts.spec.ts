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
 *   e2e/global-setup.ts, used by the Next server via BACKEND_URL). It answers GET auth/me,
 *   GET dashboard/summary (computed from the seeded non-cancelled files), GET files
 *   (status / sort / paging honoured) and GET transactions over the seeded datasets
 *   (src/mocks/data/files.ts, src/mocks/data/dashboardSummary.ts,
 *   src/mocks/data/transactions.ts).
 * - Browser side: same-origin `/api/dashboard/summary`, `/api/files` and `/api/transactions`
 *   calls pass through the Next /api proxy to that mock, so they are NOT intercepted here.
 *   `/api/events` is fulfilled with `page.route()` as an idle SSE stream.
 * - Implementation pattern this assumes:
 *   - The Dashboard shows, above the file list, the summary counts as real links (`<a>`).
 *     Each link's accessible name is the count followed by its status word, e.g. "4 Completed"
 *     or "15 Imported" (whitespace between them optional; no extra words in the name).
 *   - A file-status count links to `/dashboard?status=<Status>`, keeping the other list
 *     params (sort, page size, other filters) and dropping `page` (back to page 1).
 *   - A transaction count links to `/transactions?status=<Imported|Approved|Rejected>`.
 *   - The active status shows in story 2's filter form (shadcn Select `combobox` named
 *     "Status") and as a chip in the `list` named "Active filters".
 *   - At md+ the file list is a `table` whose file-name cells are links named by the file
 *     name (e.g. "april-batch-1.csv"); the transactions list is a `table` showing references
 *     `TXN-yyyyMMdd-NNNN`.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Seeded-dataset facts used below (see generated-docs/epics/file-dashboard-and-details/
 * mock-facts.md):
 *   - Summary: files 1 Uploaded, 1 Processing, 4 Completed, 3 Failed;
 *     transactions 15 Imported, 10 Approved, 5 Rejected.
 *   - Completed (active) files by FileName Asc: april-batch-1, april-batch-2,
 *     empty-reference-rows, march-statement-rerun.
 *   - Rejected transactions, newest first: rows 28, 22, 16, 10, 4.
 *
 * E2E spec for Epic file-dashboard-and-details, Story 3: Dashboard status and transaction
 * counts. These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { UserRole } from '../src/types/api-generated';
import { mockSessionValue } from './fixtures/mock-backend';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const REFERENCE = /^TXN-\d{8}-\d{4}$/;

/** The seeded transaction reference for row `n` (1..30), e.g. 28 -> TXN-20260428-0028. */
function ref(n: number): string {
  return `TXN-202604${String(n).padStart(2, '0')}-${String(n).padStart(4, '0')}`;
}

/** The summary count link showing `count` and `word`, e.g. countLink(page, 4, 'Completed'). */
function countLink(page: Page, count: number, word: string): Locator {
  return page.getByRole('link', {
    name: new RegExp(`^\\s*${count}\\s*${word}\\s*$`),
  });
}

/** Every summary count link with the seeded data. */
function allCountLinks(page: Page): Locator[] {
  return [
    countLink(page, 1, 'Uploaded'),
    countLink(page, 1, 'Processing'),
    countLink(page, 4, 'Completed'),
    countLink(page, 3, 'Failed'),
    countLink(page, 15, 'Imported'),
    countLink(page, 10, 'Approved'),
    countLink(page, 5, 'Rejected'),
  ];
}

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

/** The value of URL search param `name` on the current page (null when absent). */
function urlParam(page: Page, name: string): string | null {
  return new URL(page.url()).searchParams.get(name);
}

/** The file names shown in the desktop file table, in display order. */
function fileNames(page: Page): Locator {
  return page.getByRole('table').getByRole('link', { name: /\.csv$/ });
}

/** The transaction references shown in the desktop transactions table. */
function transactionRefs(page: Page): Locator {
  return page.getByRole('table').getByText(REFERENCE);
}

/** The "Active filters" chip list. */
function activeFilters(page: Page): Locator {
  return page.getByRole('list', { name: 'Active filters' });
}

/** Press Tab until `target` holds keyboard focus. Returns whether it was reached. */
async function tabTo(
  page: Page,
  target: Locator,
  maxPresses = 60,
): Promise<boolean> {
  for (let i = 0; i < maxPresses; i += 1) {
    await page.keyboard.press('Tab');
    const focused = await target.evaluate(
      (el) =>
        el === document.activeElement || el.contains(document.activeElement),
    );
    if (focused) return true;
  }
  return false;
}

/** How far the page scrolls sideways (0 = no horizontal scroll). */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

test.describe('Epic file-dashboard-and-details, Story 3: Dashboard status and transaction counts', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-2
  test('selecting a file-status count filters the list to that status, shows it as the active status filter, and returns to page 1', async ({
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

    // Start sorted by file name, 5 per page, on page 2.
    await page.goto(
      '/dashboard?sortBy=FileName&sortDirection=Asc&pageSize=5&page=2',
    );
    await expect(fileNames(page)).toHaveText([
      'march-statement-rerun.csv',
      'may-payroll.csv',
      'may-suppliers.csv',
      'Q1-Adjustments.csv',
    ]);

    // Every count is shown above the list.
    for (const link of allCountLinks(page)) {
      await expect(link).toBeVisible();
    }

    // Accessibility: scan the Dashboard with the counts and the list loaded.
    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_21_AA)
      .analyze();
    expect(violations).toEqual([]);

    // Select the Completed count.
    await countLink(page, 4, 'Completed').click();

    await expect.poll(() => urlParam(page, 'status')).toBe('Completed');
    await expect(page).toHaveURL(/\/dashboard\?/);
    // Back to page 1; the sort and page size are kept.
    expect(urlParam(page, 'page')).toBeNull();
    expect(urlParam(page, 'sortBy')).toBe('FileName');
    expect(urlParam(page, 'sortDirection')).toBe('Asc');
    expect(urlParam(page, 'pageSize')).toBe('5');

    // Only the Completed files are listed.
    await expect(fileNames(page)).toHaveText([
      'april-batch-1.csv',
      'april-batch-2.csv',
      'empty-reference-rows.csv',
      'march-statement-rerun.csv',
    ]);

    // Completed is the active status filter, in the form and as a chip.
    await expect(page.getByRole('combobox', { name: 'Status' })).toHaveText(
      /Completed/,
    );
    const chips = activeFilters(page).getByRole('listitem');
    await expect(chips).toHaveCount(1);
    await expect(chips.filter({ hasText: 'Completed' })).toBeVisible();

    // Selecting the Failed count replaces the status filter.
    await countLink(page, 3, 'Failed').click();
    await expect.poll(() => urlParam(page, 'status')).toBe('Failed');
    await expect(fileNames(page)).toHaveText([
      'april-invalid-rows.csv',
      'bank-export-copy.csv',
      'Q1-Adjustments.csv',
    ]);
    await expect(chips).toHaveCount(1);
    await expect(chips.filter({ hasText: 'Failed' })).toBeVisible();
  });

  // AC-3
  test('selecting the Imported, Approved or Rejected count opens the Transactions list filtered to that status', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAs(
      page,
      context,
      'Importer',
      baseURL ?? 'http://localhost:3000',
    );

    const cases = [
      { count: 15, status: 'Imported' },
      { count: 10, status: 'Approved' },
      { count: 5, status: 'Rejected' },
    ] as const;

    for (const { count, status } of cases) {
      await page.goto('/dashboard');
      await countLink(page, count, status).click();

      await expect(page).toHaveURL(/\/transactions\?/);
      expect(urlParam(page, 'status')).toBe(status);

      // The Transactions list shows only that status, with the matching number of rows.
      await expect(transactionRefs(page)).toHaveCount(count);
      const chips = activeFilters(page).getByRole('listitem');
      await expect(chips).toHaveCount(1);
      await expect(chips.filter({ hasText: status })).toBeVisible();
    }

    // The Rejected view lists exactly the seeded Rejected transactions, newest first.
    await expect(transactionRefs(page)).toHaveText(
      [28, 22, 16, 10, 4].map(ref),
    );
  });

  // AC-6
  test('at 360px every count is visible without sideways scrolling and each can be reached and selected by keyboard alone', async ({
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

    // Every count fits inside the 360px screen.
    for (const link of allCountLinks(page)) {
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
    }
    expect(await horizontalOverflow(page)).toBe(0);

    // Accessibility: scan the counts at phone width.
    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_21_AA)
      .analyze();
    expect(violations).toEqual([]);

    // Every count can be reached with Tab alone.
    for (const link of allCountLinks(page)) {
      await page.goto('/dashboard');
      await expect(link).toBeVisible();
      expect(await tabTo(page, link)).toBe(true);
    }

    // A file count selected with Enter filters the list.
    await page.goto('/dashboard');
    const completed = countLink(page, 4, 'Completed');
    await expect(completed).toBeVisible();
    expect(await tabTo(page, completed)).toBe(true);
    await page.keyboard.press('Enter');
    await expect.poll(() => urlParam(page, 'status')).toBe('Completed');
    await expect(page).toHaveURL(/\/dashboard\?/);

    // A transaction count selected with Enter opens the filtered Transactions list.
    await page.goto('/dashboard');
    const rejected = countLink(page, 5, 'Rejected');
    await expect(rejected).toBeVisible();
    expect(await tabTo(page, rejected)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/transactions\?.*status=Rejected/);
    await expect(
      page.getByRole('listitem').filter({ hasText: ref(28) }),
    ).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
  });
});
