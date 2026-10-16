/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: app-frontend/src/components/transactions/TransactionRowActions.tsx
 * - Page Action: modify_existing
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked. This spec never contacts a live backend and uses no
 *   real credentials. Sign-in is faked by adding `txn_session=mockSessionValue('Approver')`
 *   with `context.addCookies()`.
 * - Node side: the shared mock back-end (e2e/fixtures/mock-backend.ts, started by
 *   e2e/global-setup.ts, used by the Next server via BACKEND_URL). It answers GET auth/me,
 *   GET transactions, GET transactions/{id}, GET transactions/imported-count and
 *   POST transactions/{id}/approve | reject with real semantics (reason checked first:
 *   trimmed 1..500 `.length`; Imported -> Rejected with the TRIMMED reason, lastChangedBy
 *   "Approver User", lastChangedAt now; not Imported -> 409 `{ message, transaction }`).
 * - Every test sets its own `mock-run` cookie (MOCK_RUN_COOKIE = mockRunValue(testInfo)), so
 *   its decisions are kept for its own later reads only (parallel-safe).
 * - "Someone got there first" (AC-5) approves / rejects the transaction by calling the mock
 *   back-end DIRECTLY (127.0.0.1:MOCK_BACKEND_PORT) with the same session + run cookies,
 *   standing in for another tab. The browser's reject then gets the real 409 from the mock.
 * - Browser side: same-origin `/api/transactions/...` calls pass through the Next `/api`
 *   proxy to that mock (observed, not intercepted). Only `/api/events` is fulfilled with
 *   `page.route()`, as an idle SSE stream (the mock emits no `transactions-changed` events).
 * - Implementation pattern this assumes:
 *   - Desktop list (default viewport): a `table`; each transaction is a `row` whose text
 *     includes its reference and that holds one link to `/transactions/<id>`. An Imported
 *     row (Approver) has a text button whose accessible name is exactly
 *     "Reject <reference>" (visually hidden reference suffix), next to "Approve <reference>".
 *   - Reject opens a shadcn Dialog (role `dialog`) named "Reject <reference>?". Focus starts
 *     in a `textbox` labelled "Reason" (with `required` and a visible "*"); a counter reads
 *     "<N> characters left" (500 minus the trimmed length) and updates while typing. The
 *     submit button "Reject" is disabled while the trimmed reason is empty; "Cancel" and
 *     Escape close the dialog with nothing sent and focus back on the row's Reject button.
 *   - Submitting sends ONE browser-side `POST /api/transactions/{id}/reject` with JSON
 *     `{ reason }` trimmed. On 200: the dialog closes; a success toast inside the region
 *     "Notifications" reads "<reference> rejected." and closes itself; the row shows
 *     "Rejected" with no Approve / Reject buttons.
 *   - On 409: the dialog closes; an error toast (role `alert`, kind "Problem") inside
 *     "Notifications" shows the server's message verbatim plus "It is now <Status>." (and
 *     "Reason: <reason>" when Rejected), stays until its "Dismiss message" button is used;
 *     the row takes the transaction's current status, with no Approve / Reject.
 *   - Details (`/transactions/<id>`): "Rejected", "Rejection reason" with the stored reason,
 *     "Last changed by" Approver User and "Last changed on" in local time (YYYY-MM-DD HH:mm;
 *     this spec pins the timezone to Africa/Johannesburg).
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Mock facts used (generated-docs/epics/approve-and-reject/mock-facts.md): Imported seeded
 * transactions 27, 25, 24 and 21 (page 1 of the default list). Story 1's spec is expected to
 * use the top row (30), so this spec avoids it.
 *
 * E2E spec for Epic approve-and-reject, Story 2: Reject a transaction with a reason.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type {
  APIRequestContext,
  BrowserContext,
  Locator,
  Page,
  TestInfo,
} from '@playwright/test';
import type { UserRole } from '../src/types/api-generated';
import {
  ALREADY_APPROVED_MESSAGE,
  ALREADY_REJECTED_MESSAGE,
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
const APPROVER_NAME = 'Approver User';

// "Last changed on" is shown in local time; pin the zone so it renders deterministically.
test.use({ timezoneId: 'Africa/Johannesburg' });

async function signInAsApprover(
  page: Page,
  context: BrowserContext,
  baseURL: string,
  testInfo: TestInfo,
): Promise<void> {
  const role: UserRole = 'Approver';
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: mockSessionValue(role),
      url: baseURL,
      httpOnly: true,
      sameSite: 'Lax',
    },
    // Keeps this test's decisions for its own later reads only (parallel-safe).
    { name: MOCK_RUN_COOKIE, value: mockRunValue(testInfo), url: baseURL },
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

/** The desktop list row for the transaction with `reference`. */
function rowFor(page: Page, reference: string): Locator {
  return page.getByRole('row', { name: new RegExp(reference) });
}

/** The row's Reject trigger (accessible name "Reject <reference>"). */
function rejectTrigger(row: Locator, reference: string): Locator {
  return row.getByRole('button', { name: `Reject ${reference}`, exact: true });
}

/** The row's Approve trigger (accessible name "Approve <reference>"). */
function approveTrigger(row: Locator, reference: string): Locator {
  return row.getByRole('button', {
    name: `Approve ${reference}`,
    exact: true,
  });
}

/** The reject dialog for `reference`. */
function rejectDialog(page: Page, reference: string): Locator {
  return page.getByRole('dialog', { name: `Reject ${reference}?` });
}

/** The dialog's Reason field. */
function reasonField(dialog: Locator): Locator {
  return dialog.getByRole('textbox', { name: /^Reason/ });
}

/** The dialog's submit button. */
function submitButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: 'Reject', exact: true });
}

/** Records the body of every POST to `/api/transactions/{id}/reject` made by the page. */
function recordRejectRequests(page: Page, transactionId: string): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname ===
        `/api/transactions/${transactionId}/reject`
    ) {
      seen.push(request.postData() ?? '');
    }
  });
  return seen;
}

/** Waits for the browser's reject response for `transactionId`. */
function rejectResponse(page: Page, transactionId: string) {
  return page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname === `/api/transactions/${transactionId}/reject`,
  );
}

/** Press Tab until `target` has focus. Returns whether it was reached. */
async function tabUntilFocused(
  page: Page,
  target: Locator,
  maxPresses = 10,
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

/** `iso` as Johannesburg local time (UTC+2, no daylight saving), `YYYY-MM-DD HH:mm`. */
function johannesburgLocal(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + 2 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16).replace('T', ' ');
}

/** Decides `transactionId` directly at the mock (standing in for another tab) in this run. */
async function decideElsewhere(
  request: APIRequestContext,
  transactionId: string,
  runValue: string,
  decision: { kind: 'approve' } | { kind: 'reject'; reason: string },
): Promise<void> {
  const base = `http://127.0.0.1:${MOCK_BACKEND_PORT}/api/transactions/${transactionId}`;
  const headers = {
    cookie: `${SESSION_COOKIE}=${mockSessionValue('Approver')}; ${MOCK_RUN_COOKIE}=${runValue}`,
  };
  const response =
    decision.kind === 'approve'
      ? await request.post(`${base}/approve`, { headers })
      : await request.post(`${base}/reject`, {
          headers,
          data: { reason: decision.reason },
        });
  expect(response.status()).toBe(200);
}

test.describe('Epic approve-and-reject, Story 2: Reject a transaction with a reason', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1
  test('Reject opens a form naming the reference with a required Reason and a live count out of 500; Reject is unavailable until a reason is typed; Cancel and Escape close it with nothing changed, by keyboard', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const transactionId = seededTransactionId(27);
    const reference = seededTransactionReference(27);
    await signInAsApprover(
      page,
      context,
      baseURL ?? 'http://localhost:3000',
      testInfo,
    );
    const rejectRequests = recordRejectRequests(page, transactionId);

    await page.goto('/transactions');
    const row = rowFor(page, reference);
    await expect(row).toBeVisible();
    await expect(row).toContainText('Imported');
    const trigger = rejectTrigger(row, reference);
    const dialog = rejectDialog(page, reference);
    const reason = reasonField(dialog);

    // Open by keyboard: the form names the reference and focus starts in Reason.
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(reason).toBeFocused();
    await expect(reason).toHaveAttribute('required');
    await expect(dialog.getByText('*', { exact: true })).toBeVisible();
    await expect(dialog.getByText('500 characters left')).toBeVisible();
    await expect(submitButton(dialog)).toBeDisabled();

    // Accessibility: the empty reject form.
    await expectNoAxeViolations(page);

    // Escape closes it with focus back on Reject.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // Open again by keyboard; the count updates as the Approver types.
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(reason).toBeFocused();
    await page.keyboard.type('Duplicate payment');
    await expect(dialog.getByText('483 characters left')).toBeVisible();
    await expect(submitButton(dialog)).toBeEnabled();

    // Accessibility: the filled-in form.
    await expectNoAxeViolations(page);

    // Cancel, reached and pressed by keyboard, closes it with focus back on Reject.
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    expect(await tabUntilFocused(page, cancel)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // Nothing was sent and the transaction is unchanged, also after a reload.
    expect(rejectRequests).toEqual([]);
    await page.reload();
    await expect(rowFor(page, reference)).toContainText('Imported');
    await expect(
      rejectTrigger(rowFor(page, reference), reference),
    ).toBeVisible();
  });

  // AC-3
  test('submitting a reason rejects the transaction: a self-closing message, the row Rejected at once without actions, and the details show the reason, who and when', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const transactionId = seededTransactionId(25);
    const reference = seededTransactionReference(25);
    const typedReason = '  Beneficiary details do not match the invoice  ';
    const storedReason = typedReason.trim();
    await signInAsApprover(
      page,
      context,
      baseURL ?? 'http://localhost:3000',
      testInfo,
    );
    const rejectRequests = recordRejectRequests(page, transactionId);

    await page.goto('/transactions');
    const row = rowFor(page, reference);
    await expect(row).toContainText('Imported');
    await rejectTrigger(row, reference).click();
    const dialog = rejectDialog(page, reference);
    await expect(dialog).toBeVisible();
    await reasonField(dialog).fill(typedReason);

    const response = rejectResponse(page, transactionId);
    await submitButton(dialog).click();
    const answered = await response;
    expect(answered.status()).toBe(200);
    const decided = (await answered.json()) as { lastChangedAt: string };
    await expect(dialog).toBeHidden();

    // One request, carrying the trimmed reason.
    expect(rejectRequests.map((body) => JSON.parse(body))).toEqual([
      { reason: storedReason },
    ]);

    // A message confirms it, naming only the reference.
    const toast = page
      .getByRole('region', { name: 'Notifications' })
      .getByText(`${reference} rejected.`, { exact: true });
    await expect(toast).toBeVisible();

    // The row shows Rejected straight away, with no Approve or Reject.
    await expect(row).toContainText('Rejected');
    await expect(rejectTrigger(row, reference)).toHaveCount(0);
    await expect(approveTrigger(row, reference)).toHaveCount(0);

    // Accessibility: the list with the confirmation showing.
    await expectNoAxeViolations(page);

    // The message closes by itself.
    await expect(toast).toBeHidden({ timeout: 15_000 });

    // The details show the reason, who rejected it and when.
    await row.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`));
    const main = page.getByRole('main');
    await expect(main).toContainText(reference);
    await expect(main).toContainText('Rejected');
    await expect(main).toContainText(/rejection reason/i);
    await expect(main).toContainText(storedReason);
    await expect(main).toContainText(/last changed by/i);
    await expect(main).toContainText(APPROVER_NAME);
    await expect(main).toContainText(/last changed on/i);
    await expect(main).toContainText(johannesburgLocal(decided.lastChangedAt));
  });

  // AC-5
  test('rejecting a transaction someone else already approved or rejected changes nothing: a lasting message gives the current status and the row updates to match', async ({
    page,
    context,
    baseURL,
    request,
  }, testInfo) => {
    const approvedId = seededTransactionId(24);
    const approvedRef = seededTransactionReference(24);
    const rejectedId = seededTransactionId(21);
    const rejectedRef = seededTransactionReference(21);
    const otherReason = 'Supplier account is on hold';
    const runValue = mockRunValue(testInfo);
    // Control time so "stays until dismissed" is checked past the toast auto-close.
    await page.clock.install();
    await signInAsApprover(
      page,
      context,
      baseURL ?? 'http://localhost:3000',
      testInfo,
    );

    await page.goto('/transactions');
    const approvedRow = rowFor(page, approvedRef);
    const rejectedRow = rowFor(page, rejectedRef);
    await expect(approvedRow).toContainText('Imported');
    await expect(rejectedRow).toContainText('Imported');

    // Another tab approves the first one, in this test's mock run.
    await decideElsewhere(request, approvedId, runValue, { kind: 'approve' });

    const notifications = page.getByRole('region', { name: 'Notifications' });

    // Already approved elsewhere.
    await rejectTrigger(approvedRow, approvedRef).click();
    const approvedDialog = rejectDialog(page, approvedRef);
    await expect(approvedDialog).toBeVisible();
    await reasonField(approvedDialog).fill('Amount looks wrong');
    const firstResponse = rejectResponse(page, approvedId);
    await submitButton(approvedDialog).click();
    expect((await firstResponse).status()).toBe(409);
    await expect(approvedDialog).toBeHidden();

    const approvedProblem = notifications
      .getByRole('alert')
      .filter({ hasText: ALREADY_APPROVED_MESSAGE });
    await expect(approvedProblem).toBeVisible();
    await expect(approvedProblem).toContainText('Problem');
    await expect(approvedProblem).toContainText('It is now Approved.');
    await expect(approvedRow).toContainText('Approved');
    await expect(rejectTrigger(approvedRow, approvedRef)).toHaveCount(0);
    await expect(approveTrigger(approvedRow, approvedRef)).toHaveCount(0);

    // Accessibility: the list with the lasting problem showing.
    await expectNoAxeViolations(page);

    // It does not close by itself; dismissing it closes it.
    await page.clock.fastForward('00:20');
    await expect(approvedProblem).toBeVisible();
    await approvedProblem
      .getByRole('button', { name: 'Dismiss message' })
      .click();
    await expect(approvedProblem).toBeHidden();

    // Already rejected elsewhere: the message also gives the stored reason.
    // Decided only now — the list reloads after the first 409, which would
    // otherwise already show this row as Rejected (and hide its Reject).
    await decideElsewhere(request, rejectedId, runValue, {
      kind: 'reject',
      reason: otherReason,
    });
    await rejectTrigger(rejectedRow, rejectedRef).click();
    const rejectedDialog = rejectDialog(page, rejectedRef);
    await expect(rejectedDialog).toBeVisible();
    await reasonField(rejectedDialog).fill('Amount looks wrong');
    const secondResponse = rejectResponse(page, rejectedId);
    await submitButton(rejectedDialog).click();
    expect((await secondResponse).status()).toBe(409);
    await expect(rejectedDialog).toBeHidden();

    const rejectedProblem = notifications
      .getByRole('alert')
      .filter({ hasText: ALREADY_REJECTED_MESSAGE });
    await expect(rejectedProblem).toBeVisible();
    await expect(rejectedProblem).toContainText('It is now Rejected.');
    await expect(rejectedProblem).toContainText(`Reason: ${otherReason}`);
    await expect(rejectedRow).toContainText('Rejected');
    await expect(rejectTrigger(rejectedRow, rejectedRef)).toHaveCount(0);
    await expect(approveTrigger(rejectedRow, rejectedRef)).toHaveCount(0);

    await page.clock.fastForward('00:20');
    await expect(rejectedProblem).toBeVisible();

    // Nothing changed: the details still carry the other tab's reason, not this one's.
    await page.goto(`/transactions/${rejectedId}`);
    const main = page.getByRole('main');
    await expect(main).toContainText(rejectedRef);
    await expect(main).toContainText(otherReason);
    await expect(main).not.toContainText('Amount looks wrong');
  });
});
