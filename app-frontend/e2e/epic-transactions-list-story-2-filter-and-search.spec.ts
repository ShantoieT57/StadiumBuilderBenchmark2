/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: app-frontend/src/app/(authenticated)/transactions/page.tsx
 * - Page Action: modify_existing
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked. This spec never contacts a live backend and uses no
 *   real credentials. Sign-in is faked by seeding `txn_session=mockSessionValue(role)` with
 *   `context.addCookies()`.
 * - Node side: the shared stateless mock back-end (e2e/fixtures/mock-backend.ts, started by
 *   e2e/global-setup.ts, used by the Next server via BACKEND_URL). It answers GET auth/me,
 *   GET transactions (status, fileId, dateFrom/dateTo as whole `yyyy-MM-dd` days, inclusive
 *   min/maxAmount, case-insensitive search over reference OR account) and GET files over the
 *   seeded dataset (src/mocks/data/transactions.ts, src/mocks/data/files.ts).
 * - Browser side: same-origin `/api/transactions` and `/api/files` calls pass through the
 *   Next /api proxy to that mock, so they are NOT intercepted here (only observed, to check
 *   which search texts were sent). `/api/events` is fulfilled with `page.route()` as an idle
 *   SSE stream.
 * - Implementation pattern this assumes:
 *   - The list calls GET /api/transactions FROM THE BROWSER, and every filter lives in the
 *     URL search params next to sort / page / pageSize (`status`, `fileId`, `dateFrom`,
 *     `dateTo`, `minAmount`, `maxAmount`, `search`). Changing a filter drops `page` (back to
 *     page 1) and keeps `sortBy` / `sortDirection`.
 *   - The filter panel is a `<form>` with a submit button, so Enter in any field submits it.
 *     Controls and accessible names:
 *       - "Status": shadcn Select (`combobox`) with options "Imported", "Approved", "Rejected".
 *       - "File": shadcn Select (`combobox`) whose options are the file names from GET files
 *         (e.g. "april-batch-2.csv"). Selects apply as soon as an option is chosen.
 *       - "From date" / "To date": `<input type="date">`.
 *       - "Minimum amount" / "Maximum amount": text or number inputs.
 *       - "Search": `<input type="search">` (role `searchbox`), applied on Enter or after a
 *         short pause (>= 250ms), never on every keystroke.
 *     Date and amount fields apply when the form is submitted (Enter) with valid values.
 *   - Active filters: a `list` named "Active filters". Each active filter is a `listitem`
 *     showing its value (the file shows its file name) with a remove button named
 *     "Remove <Label> filter" (e.g. "Remove Status filter"). One button named "Clear all"
 *     removes every filter.
 *   - Desktop (>= 768px): the panel sits inline beside a `table` whose reference cells hold
 *     the reference alone. Narrow (< 768px): the inline panel is hidden; a button named
 *     exactly "Filters" opens a shadcn Sheet (role `dialog`) holding the same controls, and
 *     each transaction is a `listitem` showing its reference.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Seeded-dataset facts used below (30 rows, one per day in April 2026, reference
 * `TXN-202604DD-00NN`):
 *   - Imported + april-batch-2 + 10..20 Apr + amount 1000..5000 -> rows 13 (1,299.99) and
 *     15 (4,850.00); adding search "2002" (row 15's account 2002-7781-3346) leaves row 15.
 *   - Rejected -> rows 4, 10, 16, 22, 28. Rejected + april-batch-2 -> rows 10, 28.
 *     Rejected + search "3003" -> rows 4, 16, 28. Rejected + april-batch-2 + "3003" -> row 28.
 *   - april-batch-2 alone -> 12 rows.
 *   - Rejected + april-batch-2 + 1..15 Apr + amount 1000..10000 + search "4410" -> row 10.
 *
 * E2E spec for Epic transactions-list, Story 2: Filter and search transactions.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { UserRole } from '../src/types/api-generated';
import { mockSessionValue } from './fixtures/mock-backend';
import { SEEDED_FILE_IDS } from '../src/mocks/data/files';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const REFERENCE = /^TXN-\d{8}-\d{4}$/;
const BATCH_2 = SEEDED_FILE_IDS.aprilBatch2;

/** The seeded reference for row `n` (1..30), e.g. 30 -> TXN-20260430-0030. */
function ref(n: number): string {
  return `TXN-202604${String(n).padStart(2, '0')}-${String(n).padStart(4, '0')}`;
}

/** Seeded row numbers from `from` down to `to`, inclusive. */
function descending(from: number, to: number): number[] {
  return Array.from({ length: from - to + 1 }, (_, i) => from - i);
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

/** The references shown in the desktop table, in display order. */
function tableReferences(page: Page): Locator {
  return page.getByRole('table').getByText(REFERENCE);
}

/** The value of URL search param `name` on the current page (null when absent). */
function urlParam(page: Page, name: string): string | null {
  return new URL(page.url()).searchParams.get(name);
}

/** The "Active filters" chip list. */
function activeFilters(page: Page): Locator {
  return page.getByRole('list', { name: 'Active filters' });
}

/** Press Tab until `target` holds keyboard focus. Returns whether it was reached. */
async function tabTo(
  page: Page,
  target: Locator,
  maxPresses = 40,
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

test.describe('Epic transactions-list, Story 2: Filter and search transactions', () => {
  // Date inputs are typed as mm/dd/yyyy in the keyboard test below.
  test.use({ locale: 'en-US' });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1
  test('status, file, date range, amount range and search combine, return to page 1, keep the sort, and search does not run per keystroke', async ({
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

    // Record every search text the list asks the back-end for.
    const searchesSent: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('/api/transactions')) {
        const search = url.searchParams.get('search');
        if (search !== null) searchesSent.push(search);
      }
    });

    // Start sorted by Amount ascending, 5 per page, on page 2.
    await page.goto(
      '/transactions?sortBy=Amount&sortDirection=Asc&pageSize=5&page=2',
    );
    const refs = tableReferences(page);
    await expect(refs).toHaveCount(5);

    // Status: back to page 1, sort kept.
    await page.getByRole('combobox', { name: 'Status' }).click();
    await page.getByRole('option', { name: 'Imported', exact: true }).click();
    await expect.poll(() => urlParam(page, 'status')).toBe('Imported');
    await expect(page).not.toHaveURL(/[?&]page=2/);
    expect(urlParam(page, 'sortBy')).toBe('Amount');
    expect(urlParam(page, 'sortDirection')).toBe('Asc');

    // File.
    await page.getByRole('combobox', { name: 'File' }).click();
    await page.getByRole('option', { name: 'april-batch-2.csv' }).click();
    await expect.poll(() => urlParam(page, 'fileId')).toBe(BATCH_2);

    // Date range and amount range, applied on submit.
    await page.getByLabel('From date', { exact: true }).fill('2026-04-10');
    await page.getByLabel('To date', { exact: true }).fill('2026-04-20');
    await page.getByLabel('Minimum amount', { exact: true }).fill('1000');
    await page.getByLabel('Maximum amount', { exact: true }).fill('5000');
    await page.getByLabel('Maximum amount', { exact: true }).press('Enter');

    await expect.poll(() => urlParam(page, 'dateFrom')).toBe('2026-04-10');
    expect(urlParam(page, 'dateTo')).toBe('2026-04-20');
    expect(urlParam(page, 'minAmount')).toBe('1000');
    expect(urlParam(page, 'maxAmount')).toBe('5000');

    // Every filter applies together, still sorted by Amount ascending.
    await expect(refs).toHaveText([ref(13), ref(15)]);
    expect(urlParam(page, 'sortBy')).toBe('Amount');
    await expect(page).not.toHaveURL(/[?&]page=2/);

    // Search on the account number, typed one key at a time.
    const search = page.getByRole('searchbox', { name: 'Search' });
    await search.pressSequentially('2002', { delay: 40 });
    await search.press('Enter');

    await expect.poll(() => urlParam(page, 'search')).toBe('2002');
    await expect(refs).toHaveText([ref(15)]);
    expect(urlParam(page, 'status')).toBe('Imported');
    expect(urlParam(page, 'fileId')).toBe(BATCH_2);
    expect(urlParam(page, 'sortBy')).toBe('Amount');

    // The partial texts typed on the way were never sent to the back-end.
    expect(searchesSent).toContain('2002');
    expect(searchesSent).not.toContain('2');
    expect(searchesSent).not.toContain('20');
    expect(searchesSent).not.toContain('200');
  });

  // AC-2
  test('each active filter shows as a removable chip, removing one drops only that filter, and Clear all removes them all', async ({
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
    await page.goto(
      `/transactions?status=Rejected&fileId=${BATCH_2}&search=3003`,
    );

    const refs = tableReferences(page);
    await expect(refs).toHaveText([ref(28)]);

    // One chip per active filter, each showing its value.
    const chips = activeFilters(page).getByRole('listitem');
    await expect(chips).toHaveCount(3);
    await expect(chips.filter({ hasText: 'Rejected' })).toBeVisible();
    await expect(chips.filter({ hasText: 'april-batch-2.csv' })).toBeVisible();
    await expect(chips.filter({ hasText: '3003' })).toBeVisible();

    // Accessibility: scan the list with active filter chips.
    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_21_AA)
      .analyze();
    expect(violations).toEqual([]);

    // Removing the File chip drops only the file filter.
    await activeFilters(page)
      .getByRole('button', { name: 'Remove File filter' })
      .click();
    await expect.poll(() => urlParam(page, 'fileId')).toBeNull();
    expect(urlParam(page, 'status')).toBe('Rejected');
    expect(urlParam(page, 'search')).toBe('3003');
    await expect(chips).toHaveCount(2);
    await expect(chips.filter({ hasText: 'april-batch-2.csv' })).toHaveCount(0);
    await expect(refs).toHaveText([ref(28), ref(16), ref(4)]);

    // Clear all removes every filter and shows the full list again.
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect.poll(() => urlParam(page, 'status')).toBeNull();
    expect(urlParam(page, 'search')).toBeNull();
    await expect(chips).toHaveCount(0);
    await expect(refs).toHaveText(descending(30, 11).map(ref));
  });

  // AC-3
  test('a link carrying status and file opens the list already filtered, and reload and Back restore it', async ({
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
    await page.goto(`/transactions?status=Rejected&fileId=${BATCH_2}`);

    const refs = tableReferences(page);
    const chips = activeFilters(page).getByRole('listitem');

    // Already filtered, with both filters shown as active.
    await expect(refs).toHaveText([ref(28), ref(10)]);
    await expect(chips).toHaveCount(2);
    await expect(chips.filter({ hasText: 'Rejected' })).toBeVisible();
    await expect(chips.filter({ hasText: 'april-batch-2.csv' })).toBeVisible();

    // Reload restores the same filtered view.
    await page.reload();
    expect(urlParam(page, 'status')).toBe('Rejected');
    expect(urlParam(page, 'fileId')).toBe(BATCH_2);
    await expect(refs).toHaveText([ref(28), ref(10)]);
    await expect(chips).toHaveCount(2);

    // Leave the list, then Back returns to the same filtered view.
    await page
      .getByRole('navigation')
      .getByRole('link', { name: 'Dashboard' })
      .click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/transactions\?.*status=Rejected/);
    expect(urlParam(page, 'fileId')).toBe(BATCH_2);
    await expect(refs).toHaveText([ref(28), ref(10)]);
    await expect(chips).toHaveCount(2);

    // A link carrying the file alone opens that file's 12 transactions.
    await page.goto(`/transactions?fileId=${BATCH_2}`);
    await expect(refs).toHaveText(
      [30, 28, 25, 23, 20, 18, 15, 13, 10, 8, 5, 3].map(ref),
    );
    await expect(chips).toHaveCount(1);
    await expect(chips.filter({ hasText: 'april-batch-2.csv' })).toBeVisible();
  });

  // AC-6
  test('at 360px the filters are reachable without horizontal scroll and every filter control works by keyboard alone', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await signInAs(
      page,
      context,
      'Importer',
      baseURL ?? 'http://localhost:3000',
    );
    await page.goto('/transactions');
    await expect(
      page.getByRole('listitem').filter({ hasText: ref(30) }),
    ).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);

    // Open the filters with the keyboard.
    const filtersButton = page.getByRole('button', {
      name: 'Filters',
      exact: true,
    });
    expect(await tabTo(page, filtersButton)).toBe(true);
    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();

    const status = panel.getByRole('combobox', { name: 'Status' });
    const file = panel.getByRole('combobox', { name: 'File' });
    const fromDate = panel.getByLabel('From date', { exact: true });
    const toDate = panel.getByLabel('To date', { exact: true });
    const minAmount = panel.getByLabel('Minimum amount', { exact: true });
    const maxAmount = panel.getByLabel('Maximum amount', { exact: true });
    const search = panel.getByRole('searchbox', { name: 'Search' });

    // Every control fits inside the 360px screen, with no sideways scroll.
    for (const control of [
      status,
      file,
      fromDate,
      toDate,
      minAmount,
      maxAmount,
      search,
    ]) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
    }
    expect(await horizontalOverflow(page)).toBe(0);

    // Accessibility: scan the open filter panel at phone width.
    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_21_AA)
      .analyze();
    expect(violations).toEqual([]);

    // Status by keyboard: open, type ahead to "Rejected", choose it.
    expect(await tabTo(page, status)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('option', { name: 'Rejected', exact: true }),
    ).toBeVisible();
    await page.keyboard.type('Rej');
    await page.keyboard.press('Enter');
    await expect.poll(() => urlParam(page, 'status')).toBe('Rejected');

    // File by keyboard.
    expect(await tabTo(page, file)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('option', { name: 'april-batch-2.csv' }),
    ).toBeVisible();
    await page.keyboard.type('april-batch-2');
    await page.keyboard.press('Enter');
    await expect.poll(() => urlParam(page, 'fileId')).toBe(BATCH_2);

    // Date range by keyboard (mm/dd/yyyy segments).
    expect(await tabTo(page, fromDate)).toBe(true);
    await page.keyboard.type('04012026');
    expect(await tabTo(page, toDate)).toBe(true);
    await page.keyboard.type('04152026');

    // Amount range by keyboard.
    expect(await tabTo(page, minAmount)).toBe(true);
    await page.keyboard.type('1000');
    expect(await tabTo(page, maxAmount)).toBe(true);
    await page.keyboard.type('10000');

    // Search by keyboard, then Enter submits the filters.
    expect(await tabTo(page, search)).toBe(true);
    await page.keyboard.type('4410');
    await page.keyboard.press('Enter');

    await expect.poll(() => urlParam(page, 'search')).toBe('4410');
    expect(urlParam(page, 'status')).toBe('Rejected');
    expect(urlParam(page, 'fileId')).toBe(BATCH_2);
    expect(urlParam(page, 'dateFrom')).toBe('2026-04-01');
    expect(urlParam(page, 'dateTo')).toBe('2026-04-15');
    expect(urlParam(page, 'minAmount')).toBe('1000');
    expect(urlParam(page, 'maxAmount')).toBe('10000');

    // Close the panel with the keyboard (no-op if submitting already closed it).
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();

    // Only the transaction matching every filter remains, with no sideways scroll.
    await expect(
      page.getByRole('listitem').filter({ hasText: ref(10) }),
    ).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: ref(28) }),
    ).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBe(0);
  });
});
