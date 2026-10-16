/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: app-frontend/src/app/(authenticated)/transactions/page.tsx
 * - Page Action: modify_existing
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked. This spec never contacts a live backend and uses no
 *   real credentials. Sign-in is faked by adding `txn_session=mockSessionValue(<Role>)`
 *   with `context.addCookies()`.
 * - Node side: the shared mock back-end (e2e/fixtures/mock-backend.ts, started by
 *   e2e/global-setup.ts, used by the Next server via BACKEND_URL). It answers GET auth/me,
 *   GET transactions (with the Status filter), GET transactions/{id} and
 *   POST transactions/{id}/approve | reject with real semantics: Imported -> 200 the
 *   Approved TransactionDetails (lastChangedBy "Approver User", lastChangedAt = now, UTC);
 *   otherwise 409 `{ message, transaction }` with "This transaction has already been
 *   approved." | "...rejected." and the current details (rejectionReason when Rejected).
 * - Every test sets its own `mock-run` cookie (MOCK_RUN_COOKIE = mockRunValue(testInfo)),
 *   so its decisions are kept for its own later reads only (parallel-safe).
 * - "Someone else got there first" (AC-4) approves / rejects the transaction by calling the
 *   mock back-end DIRECTLY (127.0.0.1:MOCK_BACKEND_PORT) with the same session + run
 *   cookies, standing in for another tab. The UI's approve then gets the real 409.
 * - Browser side: same-origin `/api/transactions...` calls pass through the Next `/api`
 *   proxy to that mock (observed, not intercepted). Only `/api/events` is fulfilled with
 *   `page.route()`, as an idle SSE stream (the mock emits no events).
 * - Implementation pattern this assumes:
 *   - The approve call is made FROM THE BROWSER: one `POST /api/transactions/{id}/approve`
 *     with no body.
 *   - For an Approver, each Imported row has text buttons whose accessible names are
 *     exactly "Approve <reference>" and "Reject <reference>" (visible text "Approve" /
 *     "Reject", reference in a visually hidden suffix). Desktop (>= 768px): in a last
 *     "Actions" column of the `table`. Phone (< 768px): in each `listitem` of the list
 *     named "Transactions", after "Details". Decided rows have neither button.
 *   - Approve opens a shadcn AlertDialog (role `alertdialog`) named "Approve <reference>?"
 *     with buttons "Cancel" (focused on open) and "Approve". Escape or Cancel closes it with
 *     nothing sent and focus back on the row's Approve trigger.
 *   - On 200: the dialog closes; a success toast in the region "Notifications" reads
 *     "<reference> approved." and closes by itself; the row at once shows "Approved" with no
 *     Approve / Reject; the current view is then refetched, so with `status=Imported` in the
 *     URL the row leaves the list. The details page shows "Approver User" and the approval
 *     time as `YYYY-MM-DD HH:mm` in local time.
 *   - On 409: the dialog closes; an error toast (role `alert`, kind "Problem") shows the
 *     body's message verbatim, "It is now <Status>." and, when Rejected,
 *     "Reason: <rejectionReason>"; it stays until its "Dismiss message" button is used. The
 *     row shows the current status with no Approve / Reject.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Mock facts used (generated-docs/epics/approve-and-reject/mock-facts.md):
 *   - 30 TXN-20260430-0030 and 27 TXN-20260427-0027 are Imported (page 1 of the default
 *     list, newest first). Row 30's seeded lastChangedBy is "System".
 *
 * E2E spec for Epic approve-and-reject, Story 1: Approve a transaction.
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
import type { TransactionDetails, UserRole } from '../src/types/api-generated';
import {
  ALREADY_APPROVED_MESSAGE,
  ALREADY_REJECTED_MESSAGE,
  SEEDED_APPROVER_NAME,
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
const PHONE_WIDTH = 360;

const ID_30 = seededTransactionId(30);
const REF_30 = seededTransactionReference(30);
const ID_27 = seededTransactionId(27);
const REF_27 = seededTransactionReference(27);

// Audit times show in local time; pin the zone (fixed +02:00, no DST) for determinism.
test.use({ timezoneId: 'Africa/Johannesburg' });

async function signInAs(
  page: Page,
  context: BrowserContext,
  role: UserRole,
  baseURL: string,
  run: string,
): Promise<void> {
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: mockSessionValue(role),
      url: baseURL,
      httpOnly: true,
      sameSite: 'Lax',
    },
    // Keeps this test's decisions for its own later reads only (parallel-safe).
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

/** The desktop table row of the transaction `reference`. */
function tableRow(page: Page, reference: string): Locator {
  return page
    .getByRole('table')
    .getByRole('row')
    .filter({ hasText: reference });
}

/** The phone-layout list item of the transaction `reference`. */
function phoneItem(page: Page, reference: string): Locator {
  return page
    .getByRole('list', { name: 'Transactions', exact: true })
    .getByRole('listitem')
    .filter({ hasText: reference });
}

function approveButton(scope: Locator, reference: string): Locator {
  return scope.getByRole('button', {
    name: `Approve ${reference}`,
    exact: true,
  });
}

function rejectButton(scope: Locator, reference: string): Locator {
  return scope.getByRole('button', {
    name: `Reject ${reference}`,
    exact: true,
  });
}

function approveDialog(page: Page, reference: string): Locator {
  return page.getByRole('alertdialog', { name: `Approve ${reference}?` });
}

/** Records the body of every POST to `/api/transactions/{id}/approve` made by the page. */
function recordApproveRequests(page: Page, id: string): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === `/api/transactions/${id}/approve`
    ) {
      seen.push(request.postData() ?? '');
    }
  });
  return seen;
}

/** Confirms the open approve dialog of `id` and returns the approve response. */
async function confirmApprove(
  page: Page,
  dialog: Locator,
  id: string,
  expectedStatus: number,
): Promise<TransactionDetails | null> {
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname === `/api/transactions/${id}/approve`,
  );
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  const answer = await response;
  expect(answer.status()).toBe(expectedStatus);
  await expect(dialog).toBeHidden();
  return expectedStatus === 200
    ? ((await answer.json()) as TransactionDetails)
    : null;
}

/** The success toast for `reference`. */
function approvedToast(page: Page, reference: string): Locator {
  return page
    .getByRole('region', { name: 'Notifications' })
    .getByText(`${reference} approved.`, { exact: true });
}

/** The persistent problem toast carrying `message`. */
function problemToast(page: Page, message: string): Locator {
  return page
    .getByRole('region', { name: 'Notifications' })
    .getByRole('alert')
    .filter({ hasText: message });
}

/** An ISO UTC time as the page shows it in Johannesburg (+02:00): `YYYY-MM-DD HH:mm`. */
function johannesburgDateTime(iso: string): string {
  const shifted = new Date(Date.parse(iso) + 2 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16).replace('T', ' ');
}

/** Decides `id` directly at the mock back-end, as another Approver in another tab would. */
async function decideElsewhere(
  request: APIRequestContext,
  id: string,
  run: string,
  decision: { kind: 'approve' } | { kind: 'reject'; reason: string },
): Promise<void> {
  const headers = {
    cookie: `${SESSION_COOKIE}=${mockSessionValue('Approver')}; ${MOCK_RUN_COOKIE}=${run}`,
  };
  const url = `http://127.0.0.1:${MOCK_BACKEND_PORT}/api/transactions/${id}/${decision.kind}`;
  const answer =
    decision.kind === 'approve'
      ? await request.post(url, { headers })
      : await request.post(url, { headers, data: { reason: decision.reason } });
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

/** Asserts `control` lies fully inside a `width`-wide screen. */
async function expectInsideScreen(
  control: Locator,
  width: number,
): Promise<void> {
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? width + 1)).toBeLessThanOrEqual(width);
}

test.describe('Epic approve-and-reject, Story 1: Approve a transaction', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-2
  test('Approve asks for confirmation naming the reference with Cancel focused; Cancel and Escape close it unchanged with focus back on Approve, by keyboard', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    await signInAs(
      page,
      context,
      'Approver',
      baseURL ?? 'http://localhost:3000',
      mockRunValue(testInfo),
    );
    const approveRequests = recordApproveRequests(page, ID_30);
    await page.goto('/transactions');

    const row = tableRow(page, REF_30);
    const trigger = approveButton(row, REF_30);
    await expect(trigger).toBeVisible();
    const dialog = approveDialog(page, REF_30);
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });

    // Open by keyboard: Cancel is the default (focused) choice.
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(cancel).toBeFocused();
    await expect(
      dialog.getByRole('button', { name: 'Approve', exact: true }),
    ).toBeVisible();

    // Accessibility: the open confirmation.
    await expectNoAxeViolations(page);

    // Enter on the focused Cancel closes it; focus returns to Approve.
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // Open again by keyboard, then Escape closes it.
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // Nothing was sent and the transaction is unchanged, also after a reload.
    expect(approveRequests).toEqual([]);
    await page.reload();
    await expect(row).toContainText('Imported');
    await expect(approveButton(row, REF_30)).toBeVisible();
    await expect(rejectButton(row, REF_30)).toBeVisible();
  });

  // AC-3
  test('confirming approves: a self-closing message, the row shows Approved at once without actions, details show who and when, and a Status=Imported view drops the row', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    await signInAs(
      page,
      context,
      'Approver',
      baseURL ?? 'http://localhost:3000',
      mockRunValue(testInfo),
    );
    const approveRequests = recordApproveRequests(page, ID_30);
    await page.goto('/transactions');

    const row = tableRow(page, REF_30);
    await expect(row).toContainText('Imported');
    await approveButton(row, REF_30).click();
    const dialog = approveDialog(page, REF_30);
    await expect(dialog).toBeVisible();
    const approved = await confirmApprove(page, dialog, ID_30, 200);

    // Exactly one request, with no body.
    expect(approveRequests).toEqual(['']);

    // The confirmation message, and the row changed at once without a reload.
    const toast = approvedToast(page, REF_30);
    await expect(toast).toBeVisible();
    await expect(row).toContainText('Approved');
    await expect(row).not.toContainText('Imported');
    await expect(approveButton(row, REF_30)).toHaveCount(0);
    await expect(rejectButton(row, REF_30)).toHaveCount(0);

    // Accessibility: the list with the success message showing.
    await expectNoAxeViolations(page);

    // The message closes by itself.
    await expect(toast).toBeHidden({ timeout: 15_000 });

    // Details show who approved it and when.
    expect(approved?.lastChangedAt).toBeTruthy();
    await row.getByRole('link', { name: REF_30 }).click();
    await expect(page).toHaveURL(new RegExp(`/transactions/${ID_30}$`));
    const main = page.getByRole('main');
    await expect(main).toContainText(REF_30);
    await expect(main).toContainText('Approved');
    await expect(main).toContainText(/last changed by/i);
    await expect(main).toContainText(SEEDED_APPROVER_NAME);
    await expect(main).toContainText(
      johannesburgDateTime(approved?.lastChangedAt ?? ''),
    );

    // With the Status filter on Imported, approving a row removes it from the view.
    await page.goto('/transactions?status=Imported');
    const importedRow = tableRow(page, REF_27);
    await expect(importedRow).toBeVisible();
    await expect(tableRow(page, REF_30)).toHaveCount(0);
    await approveButton(importedRow, REF_27).click();
    const secondDialog = approveDialog(page, REF_27);
    await expect(secondDialog).toBeVisible();
    await confirmApprove(page, secondDialog, ID_27, 200);
    await expect(approvedToast(page, REF_27)).toBeVisible();
    await expect(importedRow).toHaveCount(0);
  });

  // AC-4
  test('approving a transaction someone else already approved or rejected changes nothing: a lasting message gives the current status (and reason) and the row updates', async ({
    page,
    context,
    baseURL,
    request,
  }, testInfo) => {
    const run = mockRunValue(testInfo);
    const reason = 'Beneficiary details could not be verified';
    // Control time so "stays until dismissed" is checked past the toast auto-close.
    await page.clock.install();
    await signInAs(
      page,
      context,
      'Approver',
      baseURL ?? 'http://localhost:3000',
      run,
    );
    await page.goto('/transactions');

    // --- Already approved elsewhere ---
    const row30 = tableRow(page, REF_30);
    await expect(approveButton(row30, REF_30)).toBeVisible();
    await decideElsewhere(request, ID_30, run, { kind: 'approve' });

    await approveButton(row30, REF_30).click();
    const dialog30 = approveDialog(page, REF_30);
    await expect(dialog30).toBeVisible();
    await confirmApprove(page, dialog30, ID_30, 409);

    const approvedProblem = problemToast(page, ALREADY_APPROVED_MESSAGE);
    await expect(approvedProblem).toBeVisible();
    await expect(approvedProblem).toContainText('Problem');
    await expect(approvedProblem).toContainText('It is now Approved.');

    // The row matches the server: Approved, no actions.
    await expect(row30).toContainText('Approved');
    await expect(row30).not.toContainText('Imported');
    await expect(approveButton(row30, REF_30)).toHaveCount(0);
    await expect(rejectButton(row30, REF_30)).toHaveCount(0);

    // Accessibility: the list with the conflict message showing.
    await expectNoAxeViolations(page);

    // It does not close by itself; dismissing it closes it.
    await page.clock.fastForward('00:20');
    await expect(approvedProblem).toBeVisible();
    await approvedProblem
      .getByRole('button', { name: 'Dismiss message' })
      .click();
    await expect(approvedProblem).toBeHidden();

    // --- Already rejected elsewhere ---
    const row27 = tableRow(page, REF_27);
    await expect(approveButton(row27, REF_27)).toBeVisible();
    await decideElsewhere(request, ID_27, run, { kind: 'reject', reason });

    await approveButton(row27, REF_27).click();
    const dialog27 = approveDialog(page, REF_27);
    await expect(dialog27).toBeVisible();
    await confirmApprove(page, dialog27, ID_27, 409);

    const rejectedProblem = problemToast(page, ALREADY_REJECTED_MESSAGE);
    await expect(rejectedProblem).toBeVisible();
    await expect(rejectedProblem).toContainText('It is now Rejected.');
    await expect(rejectedProblem).toContainText(`Reason: ${reason}`);

    await expect(row27).toContainText('Rejected');
    await expect(row27).not.toContainText('Imported');
    await expect(approveButton(row27, REF_27)).toHaveCount(0);
    await expect(rejectButton(row27, REF_27)).toHaveCount(0);

    await page.clock.fastForward('00:20');
    await expect(rejectedProblem).toBeVisible();
  });

  // AC-6
  test('at 360px Approve and Reject are reachable on each Imported row without sideways scrolling, and approving there works the same', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    await page.setViewportSize({ width: PHONE_WIDTH, height: 800 });
    await signInAs(
      page,
      context,
      'Approver',
      baseURL ?? 'http://localhost:3000',
      mockRunValue(testInfo),
    );
    const approveRequests = recordApproveRequests(page, ID_30);
    await page.goto('/transactions');

    // Both actions on the Imported rows fit inside the screen, with no sideways scroll.
    for (const reference of [REF_30, REF_27]) {
      const item = phoneItem(page, reference);
      await expectInsideScreen(approveButton(item, reference), PHONE_WIDTH);
      await expectInsideScreen(rejectButton(item, reference), PHONE_WIDTH);
    }
    expect(await horizontalOverflow(page)).toBe(0);

    // Approve from the phone layout.
    const item = phoneItem(page, REF_30);
    await approveButton(item, REF_30).click();
    const dialog = approveDialog(page, REF_30);
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeFocused();
    expect(await horizontalOverflow(page)).toBe(0);

    // Accessibility: the confirmation at phone width.
    await expectNoAxeViolations(page);

    await confirmApprove(page, dialog, ID_30, 200);
    expect(approveRequests).toEqual(['']);

    await expect(approvedToast(page, REF_30)).toBeVisible();
    await expect(item).toContainText('Approved');
    await expect(item).not.toContainText('Imported');
    await expect(approveButton(item, REF_30)).toHaveCount(0);
    await expect(rejectButton(item, REF_30)).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBe(0);
  });
});
