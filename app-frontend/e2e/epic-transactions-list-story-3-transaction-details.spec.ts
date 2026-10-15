/**
 * Story Metadata:
 * - Route: /transactions/[transactionId]
 * - Target File: app-frontend/src/app/(authenticated)/transactions/[transactionId]/page.tsx
 * - Page Action: create_new
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked. This spec never contacts a live backend and uses no
 *   real credentials.
 * - Sign-in uses a mock session cookie, `txn_session=mockSessionValue(<Role>)`, added with
 *   `context.addCookies()`.
 * - The shared Node-side mock back-end (e2e/fixtures/mock-backend.ts, started by
 *   global-setup.ts) answers everything else. The server-side `GET /api/auth/me` goes to it.
 *   Browser-side `GET /api/transactions`, `GET /api/transactions/{id}` and `GET /api/files`
 *   go through the Next.js `/api` proxy to it too. It serves the 30 seeded transactions from
 *   src/mocks/data/transactions.ts with real filter, sort and paging behaviour.
 * - In the browser, `page.route()` stubs only `/api/events`, with an idle SSE stream.
 * - Implementation pattern this assumes:
 *   - The details page loads `getTransaction(id)` from the browser through the `/api` proxy.
 *   - On desktop the list is a table. Each transaction is a `row` whose text includes its
 *     reference, and that row holds one link to `/transactions/<id>`.
 *   - The list state (status, sort, page, page size) lives in the URL query string, so the
 *     browser Back button from details restores the same list URL and view.
 *   - Details show every field inside `<main>`. That includes labels reading
 *     "Last changed by" and "Last changed on". Last changed on is shown in the browser's
 *     local time (the spec pins the timezone to Africa/Johannesburg).
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * E2E spec for Epic transactions-list, Story 3: Transaction details.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { UserRole } from '../src/types/api-generated';
import { mockSessionValue, SESSION_COOKIE } from './fixtures/mock-backend';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const IDLE_STREAM = 'retry: 600000\n: connected\n\n';
const REFERENCE = /TXN-\d{8}-\d{4}/;

/** Seeded transaction id for seed row `n` (1..30). */
const seededId = (n: number): string =>
  `5d0c9b10-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Last changed on is an ISO time with a +02:00 offset. Pinning the browser timezone makes
// its local rendering deterministic.
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

/** The desktop list row for the transaction with `reference`. */
function rowFor(page: Page, reference: string) {
  return page.getByRole('row', { name: new RegExp(reference) });
}

/** References of the visible list rows, in on-screen order. */
async function visibleReferences(page: Page): Promise<string[]> {
  const texts = await page.getByRole('row').allInnerTexts();
  return texts
    .map((text) => REFERENCE.exec(text)?.[0])
    .filter((ref): ref is string => typeof ref === 'string');
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

test.describe('Epic transactions-list, Story 3: Transaction details', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1
  test('selecting a transaction by mouse or keyboard opens its details with every field', async ({
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

    // Default list: newest first, so seed rows 30..11 are on page 1.
    await page.goto('/transactions');
    const approvedRow = rowFor(page, 'TXN-20260429-0029');
    await expect(approvedRow).toBeVisible();

    // Mouse: open seed row 29 (Approved, april-batch-1.csv).
    await approvedRow.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/transactions/${seededId(29)}$`));

    const main = page.getByRole('main');
    await expect(main).toContainText('TXN-20260429-0029');
    await expect(main).toContainText('16:23'); // transaction time, shown as sent
    await expect(main).toContainText('1001-2034-5567');
    await expect(main).toContainText('Rental income - Unit 4B');
    await expect(main).toContainText(/830[.,]65/);
    await expect(main).toContainText('ZAR');
    await expect(main).toContainText('Credit');
    await expect(main).toContainText('Approved');
    await expect(main).toContainText('april-batch-1.csv');
    await expect(main).toContainText(/last changed by/i);
    await expect(main).toContainText('Approver User');
    await expect(main).toContainText(/last changed on/i);
    await expect(main).toContainText('10:30'); // 2026-05-03T10:30+02:00 in local time

    // Accessibility: the details of a non-rejected transaction.
    await expectNoAxeViolations(page);

    // Keyboard: back to the list, Tab to seed row 28 (Rejected) and press Enter.
    await page.goBack();
    const rejectedLink = rowFor(page, 'TXN-20260428-0028').getByRole('link');
    await expect(rejectedLink).toBeVisible();
    expect(await tabUntilFocused(page, rejectedLink)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/transactions/${seededId(28)}$`));

    await expect(main).toContainText('TXN-20260428-0028');
    await expect(main).toContainText('15:16');
    await expect(main).toContainText('3003-1290-8814');
    await expect(main).toContainText('Card settlement - Retail POS');
    await expect(main).toContainText(/64[,\s ]?000[.,]00/);
    await expect(main).toContainText('Rejected');
    await expect(main).toContainText('april-batch-2.csv');
    await expect(main).toContainText('Approver User');
    await expect(main).toContainText(
      'Account number does not match the beneficiary',
    );

    // Accessibility: the details of a rejected transaction (read-only reason shown).
    await expectNoAxeViolations(page);
  });

  // AC-4
  test('returning from details restores the same filters, sort, page and page size', async ({
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

    // Imported only, amount high to low, 5 per page, page 2.
    await page.goto(
      '/transactions?status=Imported&sortBy=Amount&sortDirection=Desc&pageSize=5&page=2',
    );
    const pageTwo = [
      'TXN-20260403-0003',
      'TXN-20260424-0024',
      'TXN-20260419-0019',
      'TXN-20260406-0006',
      'TXN-20260413-0013',
    ];
    await expect(rowFor(page, pageTwo[0])).toBeVisible();
    expect(await visibleReferences(page)).toEqual(pageTwo);
    const listUrl = page.url();

    await rowFor(page, 'TXN-20260424-0024').getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/transactions/${seededId(24)}$`));
    await expect(page.getByRole('main')).toContainText('TXN-20260424-0024');

    await page.goBack();

    await expect(page).toHaveURL(listUrl);
    await expect(rowFor(page, pageTwo[0])).toBeVisible();
    expect(await visibleReferences(page)).toEqual(pageTwo);
  });
});
