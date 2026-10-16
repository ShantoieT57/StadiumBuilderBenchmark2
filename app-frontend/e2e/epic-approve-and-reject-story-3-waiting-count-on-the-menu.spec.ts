/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: app-frontend/src/app/(authenticated)/layout.tsx
 *   (contexts/ImportedCountContext.tsx, components/shell/ImportedCountBadge.tsx)
 * - Page Action: modify_existing
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked. This spec never contacts a live backend and uses no
 *   real credentials. Sign-in is faked by adding `txn_session=mockSessionValue('Approver')`
 *   with `context.addCookies()`.
 * - Node side: the shared mock back-end (e2e/fixtures/mock-backend.ts, started by
 *   e2e/global-setup.ts, used by the Next server via BACKEND_URL). It answers GET auth/me,
 *   GET transactions, GET transactions/imported-count (`{ count }` = Imported transactions
 *   in the run, 15 seeded), POST transactions/{id}/approve and POST
 *   transactions/{id}/reject with real semantics.
 * - Every test sets its own `mock-run` cookie (MOCK_RUN_COOKIE = mockRunValue(testInfo)), so
 *   its decisions are kept for its own later reads only (parallel-safe).
 * - Browser side: same-origin `/api/transactions...` calls pass through the Next `/api`
 *   proxy to that mock (observed, not intercepted). Only `/api/events` is fulfilled with
 *   `page.route()` (the mock emits no live events):
 *   - AC-2: an idle SSE stream.
 *   - AC-3: a held stream. Each connection waits until the test sends a frame, delivers it
 *     with `retry: 300` and ends, so the browser's EventSource reconnects for the next one.
 *     "Someone else" decides by calling the mock back-end DIRECTLY
 *     (127.0.0.1:MOCK_BACKEND_PORT) with the same session and `mock-run` cookies.
 * - Implementation pattern this assumes:
 *   - The menu is `<nav aria-label="Main">` (md+) plus, below md, a "Menu" button opening a
 *     Sheet (role `dialog`, name "Menu") with the same links (AppNav).
 *   - For an Approver, the "Transactions" link carries a badge whose accessible text is
 *     "<N> waiting for review", so the link's accessible name is "Transactions" followed by
 *     "<N> waiting for review" (any punctuation or spacing in between).
 *   - The count is loaded in the browser from GET `/api/transactions/imported-count` and
 *     refetched after the Approver's own approve / reject, and on `transactions-changed`
 *     and `resync` events from the tab's single EventSource on `/api/events`.
 *   - Row actions (stories 1-2): buttons "Approve <reference>" / "Reject <reference>";
 *     Approve opens an alertdialog "Approve <reference>?" with an "Approve" button; Reject
 *     opens a dialog "Reject <reference>?" with a "Reason" textbox and a "Reject" button.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Mock facts used (generated-docs/epics/approve-and-reject/mock-facts.md):
 *   - 15 Imported transactions seeded; each decision in a run lowers the count by one.
 *   - Imported on page 1: 30 (april-batch-2), 27 (april-batch-1), 25 (april-batch-2), ...
 *
 * E2E spec for Epic approve-and-reject, Story 3: Waiting count on the Transactions menu item.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type { BrowserContext, Locator, Page, TestInfo } from '@playwright/test';
import type { SseEventData, SseEventName } from '../src/types/api-generated';
import { SEEDED_FILE_IDS } from '../src/mocks/data/files';
import { SEEDED_IMPORTED_COUNT } from '../src/mocks/data/importedCount';
import {
  seededTransactionId,
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
const RELOAD_MARKER = '__waitingCountNoReload';

/** Signs in as the Approver with this test's own `mock-run`. Returns the run value. */
async function signInAsApprover(
  context: BrowserContext,
  baseURL: string,
  testInfo: TestInfo,
): Promise<string> {
  const run = mockRunValue(testInfo);
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
  return run;
}

/** `/api/events` as an idle stream. */
async function stubIdleEvents(page: Page): Promise<void> {
  await page.route('**/api/events', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-cache' },
      body: IDLE_STREAM,
    }),
  );
}

/** A complete SSE frame for `name` with `data`. */
function sseFrame<K extends SseEventName>(
  name: K,
  data: SseEventData[K],
): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * `/api/events` as a held stream: each connection waits for the next `send(frame)`,
 * delivers it and ends; the EventSource then reconnects (retry 300 ms) for the next one.
 */
async function stubControlledEvents(
  page: Page,
): Promise<{ send: (frame: string) => void }> {
  const queued: string[] = [];
  const waiting: ((frame: string) => void)[] = [];
  await page.route('**/api/events', async (route) => {
    const frame =
      queued.shift() ??
      (await new Promise<string>((resolve) => waiting.push(resolve)));
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-cache' },
      body: `retry: 300\n\n${frame}`,
    });
  });
  return {
    send: (frame) => {
      const next = waiting.shift();
      if (next) next(frame);
      else queued.push(frame);
    },
  };
}

/** The "Transactions" link inside `scope`, read as having `count` waiting for review. */
function transactionsLinkWithCount(scope: Locator, count: number): Locator {
  return scope.getByRole('link', {
    name: new RegExp(`^Transactions\\W*${count} waiting for review$`),
  });
}

function wideMenu(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Main' });
}

/** Marks the current document so a later check can prove no reload happened. */
async function markDocument(page: Page): Promise<void> {
  await page.evaluate((key) => {
    (window as unknown as Record<string, unknown>)[key] = true;
  }, RELOAD_MARKER);
}

async function expectSameDocument(page: Page): Promise<void> {
  const marked = await page.evaluate(
    (key) => (window as unknown as Record<string, unknown>)[key] === true,
    RELOAD_MARKER,
  );
  expect(marked).toBe(true);
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG_21_AA)
    .analyze();
  expect(violations).toEqual([]);
}

/** Approves seeded transaction `n` from the list through its confirmation; waits for the 200. */
async function approveInList(page: Page, n: number): Promise<void> {
  const reference = seededTransactionReference(n);
  await page
    .getByRole('button', { name: `Approve ${reference}`, exact: true })
    .click();
  const dialog = page.getByRole('alertdialog', {
    name: `Approve ${reference}?`,
  });
  await expect(dialog).toBeVisible();
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname ===
        `/api/transactions/${seededTransactionId(n)}/approve`,
  );
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(dialog).toBeHidden();
}

/** Rejects seeded transaction `n` from the list with a reason; waits for the 200. */
async function rejectInList(page: Page, n: number): Promise<void> {
  const reference = seededTransactionReference(n);
  await page
    .getByRole('button', { name: `Reject ${reference}`, exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: `Reject ${reference}?` });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('textbox', { name: /Reason/ })
    .fill('Amount does not match the invoice');
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname ===
        `/api/transactions/${seededTransactionId(n)}/reject`,
  );
  await dialog.getByRole('button', { name: 'Reject', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(dialog).toBeHidden();
}

test.describe('Epic approve-and-reject, Story 3: Waiting count on the Transactions menu item', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-2
  test("the menu count drops by one straight away after the Approver's own approve or reject, in the wide menu and the phone menu", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    await signInAsApprover(
      context,
      baseURL ?? 'http://localhost:3000',
      testInfo,
    );
    await stubIdleEvents(page);

    await page.goto('/transactions');
    await expect(
      page.getByRole('button', {
        name: `Approve ${seededTransactionReference(30)}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      transactionsLinkWithCount(wideMenu(page), SEEDED_IMPORTED_COUNT),
    ).toBeVisible();
    await markDocument(page);

    // Accessibility: the wide menu with the count showing.
    await expectNoAxeViolations(page);

    // Approve one: 15 -> 14 at once.
    await approveInList(page, 30);
    await expect(
      transactionsLinkWithCount(wideMenu(page), SEEDED_IMPORTED_COUNT - 1),
    ).toBeVisible();

    // Reject another: 14 -> 13 at once.
    await rejectInList(page, 27);
    await expect(
      transactionsLinkWithCount(wideMenu(page), SEEDED_IMPORTED_COUNT - 2),
    ).toBeVisible();

    // Phone width, same document: the phone menu shows the same count.
    await page.setViewportSize({ width: 360, height: 800 });
    const menuButton = page.getByRole('button', { name: 'Menu', exact: true });
    const phoneMenu = page.getByRole('dialog', { name: 'Menu' });
    await menuButton.click();
    await expect(phoneMenu).toBeVisible();
    await expect(
      transactionsLinkWithCount(phoneMenu, SEEDED_IMPORTED_COUNT - 2),
    ).toBeVisible();

    // Accessibility: the open phone menu with the count showing.
    await expectNoAxeViolations(page);

    await page.keyboard.press('Escape');
    await expect(phoneMenu).toBeHidden();

    // Approve from the phone row: 13 -> 12 in the phone menu.
    await approveInList(page, 25);
    await menuButton.click();
    await expect(phoneMenu).toBeVisible();
    await expect(
      transactionsLinkWithCount(phoneMenu, SEEDED_IMPORTED_COUNT - 3),
    ).toBeVisible();

    // All without a reload.
    await expectSameDocument(page);
  });

  // AC-3
  test("someone else's announced decision, and a re-sync, update the menu count without a reload", async ({
    page,
    context,
    baseURL,
    request,
  }, testInfo) => {
    const run = await signInAsApprover(
      context,
      baseURL ?? 'http://localhost:3000',
      testInfo,
    );
    const events = await stubControlledEvents(page);
    const otherApprover = {
      cookie: `${SESSION_COOKIE}=${mockSessionValue('Approver')}; ${MOCK_RUN_COOKIE}=${run}`,
    };
    const mockApi = `http://127.0.0.1:${MOCK_BACKEND_PORT}/api`;

    await page.goto('/transactions');
    await expect(
      transactionsLinkWithCount(wideMenu(page), SEEDED_IMPORTED_COUNT),
    ).toBeVisible();
    await markDocument(page);

    // Another Approver approves 30 (april-batch-2); the back-end announces it.
    const approved = await request.post(
      `${mockApi}/transactions/${seededTransactionId(30)}/approve`,
      { headers: otherApprover },
    );
    expect(approved.status()).toBe(200);
    events.send(
      sseFrame('transactions-changed', { fileId: SEEDED_FILE_IDS.aprilBatch2 }),
    );
    await expect(
      transactionsLinkWithCount(wideMenu(page), SEEDED_IMPORTED_COUNT - 1),
    ).toBeVisible();

    // Another Approver rejects 27 while this tab was not listening; the app re-syncs.
    const rejected = await request.post(
      `${mockApi}/transactions/${seededTransactionId(27)}/reject`,
      {
        headers: otherApprover,
        data: { reason: 'Duplicate of an earlier payment' },
      },
    );
    expect(rejected.status()).toBe(200);
    events.send(sseFrame('resync', {}));
    await expect(
      transactionsLinkWithCount(wideMenu(page), SEEDED_IMPORTED_COUNT - 2),
    ).toBeVisible();

    await expectSameDocument(page);

    // The stream's next connection is still held; release it without errors.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
