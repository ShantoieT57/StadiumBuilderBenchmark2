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
 *   e2e/global-setup.ts, used by the Next server via BACKEND_URL). Its GET files honours
 *   status, fileName (case-insensitive contains), processedFrom / processedTo (offset
 *   date-times, inclusive, unprocessed files never match), visibility (Active default |
 *   Cancelled | Both), sort and paging over the 12 seeded files (src/mocks/data/files.ts).
 * - Browser side: same-origin `/api/files` calls pass through the Next /api proxy to that
 *   mock, so they are NOT intercepted here (only observed, to check the process-date
 *   parameters sent). `/api/events` is fulfilled with `page.route()` as an idle SSE stream.
 * - Implementation pattern this assumes:
 *   - The list calls GET /api/files FROM THE BROWSER, and every filter lives in the URL
 *     next to sort / page / pageSize: `status`, `fileName`, `processedFrom` / `processedTo`
 *     (plain `yyyy-MM-dd`), `visibility` (omitted for the default "Active files").
 *     Changing a filter drops `page` (back to page 1) and keeps `sortBy` / `sortDirection`.
 *   - The API request turns the plain dates into the start of the From day
 *     (`T00:00:00.000`) and the end of the To day (`T23:59:59.999`) with the browser's
 *     local offset (e.g. `+02:00`), URL-encoded (`%2B`).
 *   - The filter panel is a `<form>`; Enter in the file name field submits it. Controls and
 *     accessible names:
 *       - "Status": shadcn Select (`combobox`), options "Any", "Uploaded", "Processing",
 *         "Completed", "Failed". Applies as soon as an option is chosen.
 *       - "Show": shadcn Select (`combobox`), options "Active files", "Cancelled files",
 *         "Both". Applies as soon as an option is chosen.
 *       - "File name": text input, applied on Enter or after a 500 ms pause.
 *       - "Processed from" / "Processed to": `<input type="date">`, applied with a button
 *         named "Apply" (or by submitting the form).
 *   - Desktop (>= 768px): the panel sits inline above a `table` with a "Last processed"
 *     column header, where each file name is a `link` (the only links in the table).
 *     Narrow (< 768px): a button named exactly "Filters" opens a shadcn Sheet (role
 *     `dialog`) holding the same controls; each file is a `listitem` showing its name.
 *   - A cancelled file's row shows the word "Cancelled".
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Seeded-dataset facts used below (generated-docs/epics/file-dashboard-and-details/
 * mock-facts.md; all times +02:00, so the spec runs in Africa/Johannesburg):
 *   - FileName Asc, size 5, page 2: march-statement-rerun, may-payroll, may-suppliers,
 *     Q1-Adjustments.
 *   - Completed (FileName Asc): april-batch-1, april-batch-2, empty-reference-rows,
 *     march-statement-rerun. + "april": april-batch-1, april-batch-2.
 *     Failed + "april": april-invalid-rows.
 *   - 30 Apr: april-batch-2, april-batch-1. 27-29 Apr: empty-reference-rows,
 *     Q1-Adjustments, march-statement-rerun. From 1 May: bank-export-copy,
 *     april-invalid-rows (may-payroll / may-suppliers are not processed yet).
 *   - Cancelled: uploaded-in-error, wrong-bank-format, feb-legacy-import. Both: 12 files.
 *
 * E2E spec for Epic file-dashboard-and-details, Story 2: Filter the file list and show
 * cancelled files. These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { UserRole } from '../src/types/api-generated';
import { mockSessionValue } from './fixtures/mock-backend';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const ACTIVE_FILES = [
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
const CANCELLED_FILES = [
  'uploaded-in-error.csv',
  'wrong-bank-format.csv',
  'feb-legacy-import.csv',
];

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

/** The desktop file table (the one with a "Last processed" column). */
function filesTable(page: Page): Locator {
  return page.getByRole('table').filter({
    has: page.getByRole('columnheader', { name: /Last processed/ }),
  });
}

/**
 * The file names shown in the desktop table, in display order. An Importer also
 * sees "Correct <file name>" shortcut links, which are not file names.
 */
function fileNames(page: Page): Locator {
  return filesTable(page).getByRole('link', { name: /^(?!Correct ).+\.csv$/ });
}

/** The table row of the file called `name`. */
function fileRow(page: Page, name: string): Locator {
  return filesTable(page).getByRole('row').filter({ hasText: name });
}

/** The value of URL search param `name` on the current page (null when absent). */
function urlParam(page: Page, name: string): string | null {
  return new URL(page.url()).searchParams.get(name);
}

async function chooseOption(
  page: Page,
  combobox: string,
  option: string,
): Promise<void> {
  await page.getByRole('combobox', { name: combobox }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

type DateOrder = 'MDY' | 'DMY' | 'YMD';

/**
 * Types `iso` (yyyy-MM-dd) into the focused native date input, segment by
 * segment in `order`. The year segment takes up to six digits, so ArrowRight
 * moves on from it when it is not last.
 */
async function typeDate(
  page: Page,
  iso: string,
  order: DateOrder,
): Promise<void> {
  const [year, month, day] = iso.split('-');
  const segments = { Y: year, M: month, D: day };
  for (const [index, part] of [...order].entries()) {
    await page.keyboard.type(segments[part as keyof typeof segments]);
    if (part === 'Y' && index < order.length - 1) {
      await page.keyboard.press('ArrowRight');
    }
  }
}

/**
 * The segment order of a native date input. Chromium takes it from the OS
 * regional format (mm/dd/yyyy, dd/mm/yyyy or yyyy/mm/dd), so find it on a
 * scratch page.
 */
async function dateInputOrder(context: BrowserContext): Promise<DateOrder> {
  const scratch = await context.newPage();
  try {
    for (const order of ['MDY', 'DMY', 'YMD'] as const) {
      await scratch.setContent('<input aria-label="Probe" type="date">');
      const probe = scratch.getByLabel('Probe');
      await probe.focus();
      await typeDate(scratch, '2026-04-15', order);
      if ((await probe.inputValue()) === '2026-04-15') return order;
    }
  } finally {
    await scratch.close();
  }
  throw new Error('Could not work out the date input segment order.');
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

test.describe('Epic file-dashboard-and-details, Story 2: Filter the file list and show cancelled files', () => {
  // The seeded process times are at +02:00; whole local days are checked in that zone.
  test.use({ timezoneId: 'Africa/Johannesburg' });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1
  test('status and file name (any case) combine, return to page 1, keep the sort, and survive reload and Back', async ({
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
    const names = fileNames(page);
    await expect(names).toHaveText([
      'march-statement-rerun.csv',
      'may-payroll.csv',
      'may-suppliers.csv',
      'Q1-Adjustments.csv',
    ]);

    // Status: back to page 1, sort kept.
    await chooseOption(page, 'Status', 'Completed');
    await expect.poll(() => urlParam(page, 'status')).toBe('Completed');
    await expect(page).not.toHaveURL(/[?&]page=2/);
    expect(urlParam(page, 'sortBy')).toBe('FileName');
    expect(urlParam(page, 'sortDirection')).toBe('Asc');
    await expect(names).toHaveText([
      'april-batch-1.csv',
      'april-batch-2.csv',
      'empty-reference-rows.csv',
      'march-statement-rerun.csv',
    ]);

    // Part of a file name in another letter case, applied after a pause.
    await page
      .getByLabel('File name', { exact: true })
      .pressSequentially('APRIL', { delay: 40 });
    await expect
      .poll(() => urlParam(page, 'fileName')?.toLowerCase() ?? null)
      .toBe('april');
    await expect(names).toHaveText(['april-batch-1.csv', 'april-batch-2.csv']);
    expect(urlParam(page, 'status')).toBe('Completed');
    expect(urlParam(page, 'sortBy')).toBe('FileName');

    // Another status keeps the file name filter.
    await chooseOption(page, 'Status', 'Failed');
    await expect.poll(() => urlParam(page, 'status')).toBe('Failed');
    await expect(names).toHaveText(['april-invalid-rows.csv']);

    // Accessibility: scan the filtered list with its active filters showing.
    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_21_AA)
      .analyze();
    expect(violations).toEqual([]);

    // Reload restores the same filtered view.
    await page.reload();
    expect(urlParam(page, 'status')).toBe('Failed');
    expect(urlParam(page, 'fileName')?.toLowerCase()).toBe('april');
    await expect(names).toHaveText(['april-invalid-rows.csv']);
    await expect(page.getByLabel('File name', { exact: true })).toHaveValue(
      /april/i,
    );

    // Leave the Dashboard, then Back returns to the same filtered view.
    await page
      .getByRole('navigation')
      .getByRole('link', { name: 'Transactions' })
      .click();
    await expect(page).toHaveURL(/\/transactions/);
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard\?.*status=Failed/);
    expect(urlParam(page, 'fileName')?.toLowerCase()).toBe('april');
    expect(urlParam(page, 'sortBy')).toBe('FileName');
    await expect(names).toHaveText(['april-invalid-rows.csv']);
  });

  // AC-2
  test('a process-date range keeps files processed within those whole local days and leaves out unprocessed files', async ({
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

    // Record the raw process-date parameters the list asks the back-end for.
    const rawQueries: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('/api/files')) rawQueries.push(url.search);
    });

    await page.goto('/dashboard');
    const names = fileNames(page);
    await expect(names).toHaveText(ACTIVE_FILES);

    const from = page.getByLabel('Processed from', { exact: true });
    const to = page.getByLabel('Processed to', { exact: true });
    const apply = page.getByRole('button', { name: 'Apply', exact: true });

    // One whole local day: 30 April.
    await from.fill('2026-04-30');
    await to.fill('2026-04-30');
    await apply.click();
    await expect.poll(() => urlParam(page, 'processedFrom')).toBe('2026-04-30');
    expect(urlParam(page, 'processedTo')).toBe('2026-04-30');
    await expect(names).toHaveText(['april-batch-2.csv', 'april-batch-1.csv']);

    // The back-end was asked for the local start and end of that day, with the
    // offset's "+" encoded as %2B (a raw "+" would arrive as a space).
    const dayQuery = rawQueries.find((search) => {
      const params = new URLSearchParams(search);
      return (
        params.get('processedFrom') === '2026-04-30T00:00:00.000+02:00' &&
        params.get('processedTo') === '2026-04-30T23:59:59.999+02:00'
      );
    });
    expect(dayQuery).toBeDefined();
    expect(dayQuery).toContain('%2B02');

    // Several days: 27 to 29 April.
    await from.fill('2026-04-27');
    await to.fill('2026-04-29');
    await apply.click();
    await expect.poll(() => urlParam(page, 'processedFrom')).toBe('2026-04-27');
    expect(urlParam(page, 'processedTo')).toBe('2026-04-29');
    await expect(names).toHaveText([
      'empty-reference-rows.csv',
      'Q1-Adjustments.csv',
      'march-statement-rerun.csv',
    ]);

    // From 1 May with no end: files not processed yet are left out.
    await to.fill('');
    await from.fill('2026-05-01');
    await apply.click();
    await expect.poll(() => urlParam(page, 'processedFrom')).toBe('2026-05-01');
    expect(urlParam(page, 'processedTo')).toBeNull();
    await expect(names).toHaveText([
      'bank-export-copy.csv',
      'april-invalid-rows.csv',
    ]);
    await expect(fileRow(page, 'may-payroll.csv')).toHaveCount(0);
    await expect(fileRow(page, 'may-suppliers.csv')).toHaveCount(0);
  });

  // AC-4
  test('cancelled files are hidden by default, "Cancelled files" shows only them and "Both" shows all files', async ({
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
    const names = fileNames(page);

    // Default: active files only.
    await expect(names).toHaveText(ACTIVE_FILES);
    for (const name of CANCELLED_FILES) {
      await expect(fileRow(page, name)).toHaveCount(0);
    }

    // Cancelled files only, each marked Cancelled in words.
    await chooseOption(page, 'Show', 'Cancelled files');
    await expect.poll(() => urlParam(page, 'visibility')).toBe('Cancelled');
    await expect(names).toHaveText(CANCELLED_FILES);
    for (const name of CANCELLED_FILES) {
      await expect(fileRow(page, name)).toContainText('Cancelled');
    }

    // Both: active and cancelled together.
    await chooseOption(page, 'Show', 'Both');
    await expect.poll(() => urlParam(page, 'visibility')).toBe('Both');
    await expect(names).toHaveCount(12);
    for (const name of [...ACTIVE_FILES, ...CANCELLED_FILES]) {
      await expect(fileRow(page, name)).toHaveCount(1);
    }
    await expect(fileRow(page, 'feb-legacy-import.csv')).toContainText(
      'Cancelled',
    );
    await expect(fileRow(page, 'april-batch-1.csv')).not.toContainText(
      'Cancelled',
    );

    // Accessibility: scan the list showing active and cancelled files.
    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_21_AA)
      .analyze();
    expect(violations).toEqual([]);

    // Back to active files: the default leaves the address bar.
    await chooseOption(page, 'Show', 'Active files');
    await expect.poll(() => urlParam(page, 'visibility')).toBeNull();
    await expect(names).toHaveText(ACTIVE_FILES);
  });

  // AC-6
  test('at 360px the filters open from a "Filters" button, work by keyboard alone, and the page has no horizontal scroll', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const dateOrder = await dateInputOrder(context);
    await signInAs(
      page,
      context,
      'Importer',
      baseURL ?? 'http://localhost:3000',
    );
    await page.goto('/dashboard');
    await expect(
      page.getByRole('listitem').filter({ hasText: 'may-payroll.csv' }),
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
    const show = panel.getByRole('combobox', { name: 'Show' });
    const fileName = panel.getByLabel('File name', { exact: true });
    const from = panel.getByLabel('Processed from', { exact: true });
    const to = panel.getByLabel('Processed to', { exact: true });

    // Every control fits inside the 360px screen, with no sideways scroll.
    for (const control of [status, show, fileName, from, to]) {
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

    // Status by keyboard: open, type ahead to "Completed", choose it.
    expect(await tabTo(page, status)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('option', { name: 'Completed', exact: true }),
    ).toBeVisible();
    await page.keyboard.type('Comp');
    await page.keyboard.press('Enter');
    await expect.poll(() => urlParam(page, 'status')).toBe('Completed');

    // Show by keyboard: type ahead to "Both".
    expect(await tabTo(page, show)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('option', { name: 'Both', exact: true }),
    ).toBeVisible();
    await page.keyboard.type('Both');
    await page.keyboard.press('Enter');
    await expect.poll(() => urlParam(page, 'visibility')).toBe('Both');

    // Date range by keyboard (segment order follows the OS date format).
    expect(await tabTo(page, from)).toBe(true);
    await typeDate(page, '2026-04-30', dateOrder);
    expect(await tabTo(page, to)).toBe(true);
    await typeDate(page, '2026-04-30', dateOrder);

    // File name by keyboard, then Enter submits the filters.
    expect(await tabTo(page, fileName)).toBe(true);
    await page.keyboard.type('batch');
    await page.keyboard.press('Enter');

    await expect.poll(() => urlParam(page, 'fileName')).toBe('batch');
    expect(urlParam(page, 'processedFrom')).toBe('2026-04-30');
    expect(urlParam(page, 'processedTo')).toBe('2026-04-30');
    expect(urlParam(page, 'status')).toBe('Completed');
    expect(urlParam(page, 'visibility')).toBe('Both');

    // Close the panel with the keyboard (no-op if submitting already closed it).
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();

    // Only the files matching every filter remain, with no sideways scroll.
    await expect(
      page.getByRole('listitem').filter({ hasText: 'april-batch-1.csv' }),
    ).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'april-batch-2.csv' }),
    ).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'may-payroll.csv' }),
    ).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBe(0);
  });
});
