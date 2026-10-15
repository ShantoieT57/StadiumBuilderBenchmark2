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
 *   e2e/global-setup.ts on :5199, used by the Next server via BACKEND_URL). It answers
 *   GET auth/me and GET transactions with real paging / sort / filter semantics over the
 *   seeded 30-row dataset (src/mocks/data/transactions.ts).
 * - Browser side: same-origin `/api/transactions` calls pass through the Next /api proxy to
 *   that mock, so they are NOT intercepted here. Only `/api/events` is fulfilled with
 *   `page.route()` as an idle SSE stream.
 * - Implementation pattern this assumes:
 *   - The list calls GET /api/transactions FROM THE BROWSER (client component via
 *     `getTransactions`), and sort / page / pageSize live in the URL search params
 *     (defaults omitted). Reload and Back therefore restore the view.
 *   - Desktop (>= 768px): a `table`. Each column header is a `columnheader` holding a sort
 *     `button`. The reference cell's text is the reference alone (e.g. `TXN-20260430-0030`).
 *     A non-default column sorts ascending on first click and toggles on the next.
 *   - Paging: buttons named "Next page" and "Previous page".
 *   - Page size: a combobox (shadcn Select) whose accessible name contains "per page",
 *     with options named "5", "10", "20" and "50".
 *   - Narrow (< 768px): each transaction is a `listitem` holding the reference, date and
 *     time, amount with currency, Credit/Debit, the status in words, and a `link` to open
 *     details whose name mentions "details" or the reference.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Seeded-dataset facts used below: 30 rows, one per day in April 2026, reference
 * `TXN-202604DD-00NN`; newest first puts TXN-20260430-0030 at the top; Amount Desc puts
 * TXN-20260408-0008 (98,250.75) first; Amount Asc puts TXN-20260409-0009 (45.00) first.
 *
 * E2E spec for Epic transactions-list, Story 1: Transactions list with sorting, paging and
 * phone layout. These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type { BrowserContext, Page } from '@playwright/test';
import type { UserRole } from '../src/types/api-generated';
import { mockSessionValue } from './fixtures/mock-backend';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const REFERENCE = /^TXN-\d{8}-\d{4}$/;

/** The seeded reference for row `n` (1..30), e.g. 30 -> TXN-20260430-0030. */
function ref(n: number): string {
  return `TXN-202604${String(n).padStart(2, '0')}-${String(n).padStart(4, '0')}`;
}

/** Seeded row numbers from `from` down to `to`, inclusive. */
function descending(from: number, to: number): number[] {
  return Array.from({ length: from - to + 1 }, (_, i) => from - i);
}

/** Seeded row numbers ordered by amount, smallest first (all 30). */
const BY_AMOUNT_ASC = [
  9, 16, 4, 25, 20, 2, 11, 22, 14, 7, 29, 18, 27, 13, 6, 19, 24, 3, 15, 26, 21,
  10, 30, 5, 1, 23, 12, 17, 28, 8,
];
const BY_AMOUNT_DESC = [...BY_AMOUNT_ASC].reverse();

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
function tableReferences(page: Page) {
  return page.getByRole('table').getByText(REFERENCE);
}

test.describe('Epic transactions-list, Story 1: Transactions list with sorting, paging and phone layout', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-2
  test('opens newest first, sorts by a column header, keeps the sort while paging, and restores it on reload and Back', async ({
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
    await page.goto('/transactions');

    // Newest first by default, and the defaults stay out of the address bar.
    const refs = tableReferences(page);
    await expect(refs).toHaveText(descending(30, 11).map(ref));
    await expect(page).not.toHaveURL(/sortBy=/);

    // Accessibility: scan the loaded desktop list.
    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_21_AA)
      .analyze();
    expect(violations).toEqual([]);

    // First click on Amount sorts ascending; the second click toggles to descending.
    const amountSort = page
      .getByRole('table')
      .getByRole('columnheader', { name: /amount/i })
      .getByRole('button');
    await amountSort.click();
    await expect(page).toHaveURL(/sortBy=Amount/);
    await expect(refs).toHaveText(BY_AMOUNT_ASC.slice(0, 20).map(ref));

    await amountSort.click();
    await expect(page).toHaveURL(/sortDirection=Desc/);
    await expect(refs).toHaveText(BY_AMOUNT_DESC.slice(0, 20).map(ref));

    // The sort stays while paging forward and back.
    await page.getByRole('button', { name: /next page/i }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page).toHaveURL(/sortBy=Amount/);
    await expect(refs).toHaveText(BY_AMOUNT_DESC.slice(20).map(ref));

    await page.getByRole('button', { name: /previous page/i }).click();
    await expect(refs).toHaveText(BY_AMOUNT_DESC.slice(0, 20).map(ref));
    await expect(page).toHaveURL(/sortBy=Amount/);

    await page.getByRole('button', { name: /next page/i }).click();
    await expect(refs).toHaveText(BY_AMOUNT_DESC.slice(20).map(ref));

    // Reload restores the same sort and page.
    await page.reload();
    await expect(page).toHaveURL(/sortBy=Amount/);
    await expect(page).toHaveURL(/page=2/);
    await expect(refs).toHaveText(BY_AMOUNT_DESC.slice(20).map(ref));

    // Leave the list, then Back returns to the same sort and page.
    await page
      .getByRole('navigation')
      .getByRole('link', { name: 'Dashboard' })
      .click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/transactions\?.*sortBy=Amount/);
    await expect(page).toHaveURL(/page=2/);
    await expect(refs).toHaveText(BY_AMOUNT_DESC.slice(20).map(ref));
  });

  // AC-3
  test('shows 20 per page by default, and choosing 5, 10, 20 or 50 changes the page size and returns to page 1', async ({
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
    await page.goto('/transactions');

    const refs = tableReferences(page);
    await expect(refs).toHaveText(descending(30, 11).map(ref));

    // Move to page 2 first, so the size change has to return to page 1.
    await page.getByRole('button', { name: /next page/i }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(refs).toHaveText(descending(10, 1).map(ref));

    const perPage = page.getByRole('combobox', { name: /per page/i });

    await perPage.click();
    await page.getByRole('option', { name: '5', exact: true }).click();
    await expect(page).toHaveURL(/pageSize=5/);
    await expect(page).not.toHaveURL(/[?&]page=2/);
    await expect(refs).toHaveText(descending(30, 26).map(ref));

    await perPage.click();
    await page.getByRole('option', { name: '10', exact: true }).click();
    await expect(page).toHaveURL(/pageSize=10/);
    await expect(refs).toHaveText(descending(30, 21).map(ref));

    await perPage.click();
    await page.getByRole('option', { name: '50', exact: true }).click();
    await expect(page).toHaveURL(/pageSize=50/);
    await expect(refs).toHaveText(descending(30, 1).map(ref));

    // Back to the default size: 20 rows, page 1, and the default leaves the URL.
    await perPage.click();
    await page.getByRole('option', { name: '20', exact: true }).click();
    await expect(page).not.toHaveURL(/pageSize=/);
    await expect(refs).toHaveText(descending(30, 11).map(ref));
  });

  // AC-5
  test('at 360px each row shows reference, date, amount with Credit/Debit and status, details stay reachable, and there is no horizontal scroll', async ({
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
    await page.goto('/transactions');

    // Seeded row 30: 2026-04-30T07:30:00, 9,999.99 ZAR, Debit, Imported.
    const row = page
      .getByRole('listitem')
      .filter({ hasText: 'TXN-20260430-0030' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('07:30');
    await expect(row).toContainText(/9[\s,  ]?999[.,]99/);
    await expect(row).toContainText('ZAR');
    await expect(row).toContainText('Debit');
    await expect(row).toContainText('Imported');

    // Details stay reachable inside the viewport.
    const details = row.getByRole('link', {
      name: /details|TXN-20260430-0030/i,
    });
    await expect(details).toBeVisible();
    const box = await details.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);

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
  });
});
