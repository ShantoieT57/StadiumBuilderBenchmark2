/**
 * Story Metadata:
 * - Route: /dashboard/files/[fileId]
 * - Target File: app-frontend/src/app/(authenticated)/dashboard/files/[fileId]/page.tsx
 * - Page Action: create_new
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked. This spec never contacts a live backend and uses no
 *   real credentials. Sign-in is faked by adding `txn_session=mockSessionValue(<Role>)`
 *   with `context.addCookies()`.
 * - Node side: the shared stateless mock back-end (e2e/fixtures/mock-backend.ts, started by
 *   e2e/global-setup.ts, used by the Next server via BACKEND_URL). It answers GET auth/me,
 *   GET files (real filter / sort / paging over the 12 seeded files), GET files/{id}
 *   (seeded FileDetails, 404 "File not found" otherwise) and GET transactions (30 seeded
 *   transactions; april-batch-1.csv holds 9 Imported, 6 Approved, 3 Rejected).
 * - Browser side: same-origin `/api/files`, `/api/files/{id}` and `/api/transactions` calls
 *   pass through the Next `/api` proxy to that mock (not intercepted here). Only
 *   `/api/events` is fulfilled with `page.route()`, as an idle SSE stream.
 * - Implementation pattern this assumes:
 *   - Dashboard (>= 768px) is a `table`; each file's name is a link named exactly the file
 *     name (e.g. "april-batch-1.csv") to `/dashboard/files/<id>`. The list state (filters,
 *     sort, page, page size) lives in the URL with the API's param names (`fileName`,
 *     `visibility`, `sortBy`, `sortDirection`, `page`, `pageSize`).
 *   - The details view loads `getFile(id)` from the browser through the `/api` proxy and
 *     renders inside `<main>`: the file name as a heading (any level), the status in
 *     words ("Completed"), and a
 *     `<dl>` row summary whose `<dt>` labels are "Total rows", "Loaded",
 *     "Skipped – reference already existed" and "Ignored – empty reference", each followed
 *     by its `<dd>` value shown exactly as returned.
 *   - The Imported / Approved / Rejected counts are links whose accessible names contain
 *     the status word (e.g. "9 Imported"), pointing at
 *     `/transactions?fileId=<id>&status=<Status>`.
 *   - A link named "Back to dashboard" returns to the remembered list URL (the list stores
 *     its search when a file is opened). The browser Back button also restores the list.
 *   - The transactions list (>= 768px) is a `table` whose reference cells hold the reference
 *     alone, with an "Active filters" `list` showing the status and the file name.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Seeded facts used (generated-docs/epics/file-dashboard-and-details/mock-facts.md):
 *   - april-batch-1.csv: Completed, 18 rows, 18 / 0 / 0 loaded / skipped / ignored,
 *     9 Imported / 6 Approved / 3 Rejected.
 *   - march-statement-rerun.csv: Completed, 8 rows, 0 / 7 / 1, fully reviewed.
 *   - visibility=Both + fileName "e" -> 7 files; FileName Desc, 5 per page, page 2 ->
 *     empty-reference-rows.csv, bank-export-copy.csv.
 *
 * E2E spec for Epic file-dashboard-and-details, Story 4: File details.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { UserRole } from '../src/types/api-generated';
import { mockSessionValue, SESSION_COOKIE } from './fixtures/mock-backend';
import { DASHBOARD_FILE_IDS } from '../src/mocks/data/files';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const IDLE_STREAM = 'retry: 600000\n: connected\n\n';
const REFERENCE = /^TXN-\d{8}-\d{4}$/;
const BATCH_1 = DASHBOARD_FILE_IDS.aprilBatch1;

// Times on the details page are local; pin the zone so the page renders deterministically.
test.use({ timezoneId: 'Africa/Johannesburg' });

async function signInAs(
  page: Page,
  context: BrowserContext,
  role: UserRole,
  baseURL: string,
): Promise<void> {
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: mockSessionValue(role),
      url: baseURL,
      httpOnly: true,
      sameSite: 'Lax',
    },
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

/** The `<dd>` value that follows the `<dt>` whose text matches `label`. */
function summaryValue(page: Page, label: RegExp): Locator {
  return page
    .getByRole('main')
    .locator('dt')
    .filter({ hasText: label })
    .locator('xpath=following-sibling::dd[1]');
}

/** The dashboard file-name link for `fileName`. */
function fileLink(page: Page, fileName: string): Locator {
  return page.getByRole('link', { name: fileName, exact: true });
}

/** File names shown in the dashboard table, in display order. */
async function visibleFileNames(page: Page): Promise<string[]> {
  const names = await page
    .getByRole('table')
    .getByRole('link', { name: /\.csv$/ })
    .allInnerTexts();
  return names.map((name) => name.trim());
}

/** The search params of the current page as a sorted list of `key=value` pairs. */
function sortedParams(url: string): string[] {
  return [...new URL(url).searchParams.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort();
}

/** The value of URL search param `name` on the current page (null when absent). */
function urlParam(page: Page, name: string): string | null {
  return new URL(page.url()).searchParams.get(name);
}

/** Press Tab until `target` has focus. Returns whether it was reached. */
async function tabUntilFocused(
  page: Page,
  target: Locator,
  maxPresses = 120,
): Promise<boolean> {
  for (let i = 0; i < maxPresses; i += 1) {
    await page.keyboard.press('Tab');
    const focused = await target.evaluate(
      (el) => el === document.activeElement,
    );
    if (focused) return true;
  }
  return false;
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG_21_AA)
    .analyze();
  expect(violations).toEqual([]);
}

test.describe('Epic file-dashboard-and-details, Story 4: File details', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1
  test('selecting a file by mouse or keyboard opens its details with name, status and row counts', async ({
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

    await page.goto('/dashboard');
    const batchLink = fileLink(page, 'april-batch-1.csv');
    await expect(batchLink).toBeVisible();

    // Mouse: april-batch-1.csv (Completed, 18 rows, all loaded).
    await batchLink.click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/files/${BATCH_1}$`));

    const main = page.getByRole('main');
    await expect(
      main.getByRole('heading', { name: 'april-batch-1.csv' }),
    ).toBeVisible();
    await expect(main).toContainText('Completed');
    await expect(summaryValue(page, /^Total rows$/)).toHaveText('18');
    await expect(summaryValue(page, /^Loaded$/)).toHaveText('18');
    await expect(summaryValue(page, /^Skipped/)).toHaveText('0');
    await expect(summaryValue(page, /^Ignored/)).toHaveText('0');

    // Accessibility: details of a file with transactions still to review.
    await expectNoAxeViolations(page);

    // Keyboard: back to the list, Tab to march-statement-rerun.csv and press Enter.
    await page.goBack();
    const rerunLink = fileLink(page, 'march-statement-rerun.csv');
    await expect(rerunLink).toBeVisible();
    expect(await tabUntilFocused(page, rerunLink)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/files/${DASHBOARD_FILE_IDS.allSkipped}$`),
    );

    await expect(
      main.getByRole('heading', { name: 'march-statement-rerun.csv' }),
    ).toBeVisible();
    await expect(main).toContainText('Completed');
    await expect(summaryValue(page, /^Total rows$/)).toHaveText('8');
    await expect(summaryValue(page, /^Loaded$/)).toHaveText('0');
    await expect(summaryValue(page, /^Skipped/)).toHaveText('7');
    await expect(summaryValue(page, /^Ignored/)).toHaveText('1');

    // Accessibility: details of a fully reviewed file.
    await expectNoAxeViolations(page);
  });

  // AC-2
  test('selecting the Imported, Approved or Rejected count opens Transactions filtered to that file and status', async ({
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

    const cases = [
      { status: 'Imported', count: 9 },
      { status: 'Approved', count: 6 },
      { status: 'Rejected', count: 3 },
    ] as const;

    for (const { status, count } of cases) {
      await page.goto(`/dashboard/files/${BATCH_1}`);
      const main = page.getByRole('main');
      await expect(
        main.getByRole('heading', { name: 'april-batch-1.csv' }),
      ).toBeVisible();

      await main.getByRole('link', { name: new RegExp(status, 'i') }).click();

      await expect(page).toHaveURL(/\/transactions\?/);
      expect(urlParam(page, 'fileId')).toBe(BATCH_1);
      expect(urlParam(page, 'status')).toBe(status);

      const chips = page
        .getByRole('list', { name: 'Active filters' })
        .getByRole('listitem');
      await expect(chips.filter({ hasText: status })).toBeVisible();
      await expect(
        chips.filter({ hasText: 'april-batch-1.csv' }),
      ).toBeVisible();

      const rows = page
        .getByRole('table')
        .getByRole('row')
        .filter({ hasText: /TXN-\d{8}-\d{4}/ });
      await expect(page.getByRole('table').getByText(REFERENCE)).toHaveCount(
        count,
      );
      await expect(rows.filter({ hasText: status })).toHaveCount(count);
    }
  });

  // AC-6
  test('"Back to dashboard" returns to the file list with the same filters, sort, page and page size', async ({
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

    // Name contains "e", active and cancelled, name Z-A, 5 per page, page 2.
    await page.goto(
      '/dashboard?fileName=e&visibility=Both&sortBy=FileName&sortDirection=Desc&pageSize=5&page=2',
    );
    const pageTwo = ['empty-reference-rows.csv', 'bank-export-copy.csv'];
    await expect(fileLink(page, pageTwo[0])).toBeVisible();
    expect(await visibleFileNames(page)).toEqual(pageTwo);
    const listParams = sortedParams(page.url());

    // Open a file, then use "Back to dashboard".
    await fileLink(page, 'empty-reference-rows.csv').click();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/files/${DASHBOARD_FILE_IDS.emptyReferences}$`),
    );
    await expect(
      page.getByRole('main').getByRole('heading', {
        name: 'empty-reference-rows.csv',
      }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Back to dashboard' }).click();

    await expect(page).toHaveURL(/\/dashboard\?/);
    expect(new URL(page.url()).pathname).toBe('/dashboard');
    expect(sortedParams(page.url())).toEqual(listParams);
    await expect(fileLink(page, pageTwo[0])).toBeVisible();
    expect(await visibleFileNames(page)).toEqual(pageTwo);

    // The browser Back button from the details restores the same view too.
    await fileLink(page, 'bank-export-copy.csv').click();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/files/${DASHBOARD_FILE_IDS.duplicate}$`),
    );
    await expect(
      page.getByRole('main').getByRole('heading', {
        name: 'bank-export-copy.csv',
      }),
    ).toBeVisible();

    await page.goBack();

    expect(new URL(page.url()).pathname).toBe('/dashboard');
    expect(sortedParams(page.url())).toEqual(listParams);
    await expect(fileLink(page, pageTwo[0])).toBeVisible();
    expect(await visibleFileNames(page)).toEqual(pageTwo);
  });
});
