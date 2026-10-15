/**
 * Story Metadata:
 * - Route: /dashboard/files/[fileId]
 * - Target File: app-frontend/src/app/(authenticated)/dashboard/files/[fileId]/page.tsx
 * - Page Action: modify_existing
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked. This spec never contacts a live backend and uses no
 *   real credentials. Sign-in is faked by adding `txn_session=mockSessionValue(<Role>)`
 *   with `context.addCookies()`.
 * - Node side: the shared mock back-end (e2e/fixtures/mock-backend.ts, started by
 *   e2e/global-setup.ts, used by the Next server via BACKEND_URL). It answers GET auth/me,
 *   GET files (visibility Active | Cancelled | Both), GET files/{id} and
 *   POST files/{id}/cancel with real semantics: 409 `{ message: cannotCancelMessage(n) }`
 *   for april-batch-1 (6 approved) / april-batch-2 (4); otherwise 200 the cancelled
 *   FileDetails (by "File Importer", counts 0, canDownload false).
 * - Each test that cancels and then reads back sets its own `mock-run` cookie
 *   (MOCK_RUN_COOKIE = mockRunValue(testInfo)), so the cancel is kept for that test only.
 * - Browser side: same-origin `/api/files/...` calls pass through the Next `/api` proxy to
 *   that mock (observed, not intercepted). Only `/api/events` is fulfilled with
 *   `page.route()`, as an idle SSE stream (the mock emits no `file-changed` events).
 * - Implementation pattern this assumes:
 *   - The details page shows, for an Importer, a `button` named exactly "Cancel file"
 *     in the header actions. It opens a shadcn AlertDialog (role `alertdialog`) whose
 *     name is "Cancel <file name>?", with buttons "Keep file" (focused on open) and
 *     "Cancel file". Escape or "Keep file" closes it with no request sent and focus
 *     back on the "Cancel file" trigger.
 *   - Confirming sends ONE browser-side `POST /api/files/{id}/cancel` with no body.
 *   - On 200: the dialog closes; a success toast inside the region "Notifications"
 *     reads "<file name> has been cancelled." and closes itself (5 s default); the
 *     details at once show "This file was cancelled" with "Cancelled on <local> by
 *     File Importer", the transaction counts "0 Imported" / "0 Approved" / "0 Rejected",
 *     and no "Download original" or "Cancel file" button.
 *   - On 409: the dialog closes; an error toast (role `alert`, kind "Problem") shows the
 *     back-end's message verbatim, stays until its "Dismiss message" button is used,
 *     and the file stays active (no "This file was cancelled", "Download original"
 *     and "Cancel file" still offered).
 *   - Dashboard list (>= 768px): a `table` with a "Last processed" column, each file a
 *     link named by its file name; the "Show" combobox ("Active files" / "Cancelled
 *     files" / "Both") sets `visibility` in the URL; a cancelled row shows "Cancelled".
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Mock facts used (generated-docs/epics/file-correction-and-cancel/mock-facts.md):
 *   - 03 march-statement-rerun.csv: Completed, no approved transactions (cancellable).
 *   - 06 april-invalid-rows.csv: Failed, cancellable. After cancelling: Active list 8
 *     files, Cancelled view 4.
 *   - 01 april-batch-1.csv: 409 "This file cannot be cancelled because 6 of its
 *     transactions have been approved."
 *
 * E2E spec for Epic file-correction-and-cancel, Story 3: Cancel a file.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type { BrowserContext, Locator, Page, TestInfo } from '@playwright/test';
import type { UserRole } from '../src/types/api-generated';
import {
  DASHBOARD_FILE_IDS,
  SEEDED_UPLOADER,
  cannotCancelMessage,
} from '../src/mocks/data/files';
import {
  MOCK_RUN_COOKIE,
  SESSION_COOKIE,
  mockRunValue,
  mockSessionValue,
} from './fixtures/mock-backend';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const IDLE_STREAM = 'retry: 600000\n: connected\n\n';

// Times on the details page are local; pin the zone so the page renders deterministically.
test.use({ timezoneId: 'Africa/Johannesburg' });

async function signInAs(
  page: Page,
  context: BrowserContext,
  role: UserRole,
  baseURL: string,
  testInfo: TestInfo,
): Promise<void> {
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: mockSessionValue(role),
      url: baseURL,
      httpOnly: true,
      sameSite: 'Lax',
    },
    // Keeps this test's cancel for its own later reads only (parallel-safe).
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

/** Opens the details of `fileId` and waits for its heading. */
async function openDetails(
  page: Page,
  fileId: string,
  fileName: string,
): Promise<Locator> {
  await page.goto(`/dashboard/files/${fileId}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: fileName })).toBeVisible();
  return main;
}

/** Records every POST to `/api/files/{fileId}/cancel` made by the page. */
function recordCancelRequests(page: Page, fileId: string): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === `/api/files/${fileId}/cancel`
    ) {
      seen.push(request.postData() ?? '');
    }
  });
  return seen;
}

/** The success toast for `fileName`. */
function cancelledToast(page: Page, fileName: string): Locator {
  return page
    .getByRole('region', { name: 'Notifications' })
    .getByText(`${fileName} has been cancelled.`, { exact: true });
}

/** The desktop file table (the one with a "Last processed" column). */
function filesTable(page: Page): Locator {
  return page.getByRole('table').filter({
    has: page.getByRole('columnheader', { name: /Last processed/ }),
  });
}

/** The table row of the file called `name`. */
function fileRow(page: Page, name: string): Locator {
  return filesTable(page).getByRole('row').filter({ hasText: name });
}

/** Confirms the cancel of `fileName` from its details and waits for the 200. */
async function cancelFromDetails(
  page: Page,
  main: Locator,
  fileId: string,
  fileName: string,
): Promise<void> {
  await main.getByRole('button', { name: 'Cancel file', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: `Cancel ${fileName}?` });
  await expect(dialog).toBeVisible();
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname === `/api/files/${fileId}/cancel`,
  );
  await dialog
    .getByRole('button', { name: 'Cancel file', exact: true })
    .click();
  expect((await response).status()).toBe(200);
  await expect(dialog).toBeHidden();
}

test.describe('Epic file-correction-and-cancel, Story 3: Cancel a file', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-2
  test('"Cancel file" asks for confirmation naming the file with "Keep file" focused; Keep file and Escape close it with the file unchanged, by keyboard', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const fileId = DASHBOARD_FILE_IDS.allSkipped;
    const fileName = 'march-statement-rerun.csv';
    await signInAs(
      page,
      context,
      'Importer',
      baseURL ?? 'http://localhost:3000',
      testInfo,
    );
    const cancelRequests = recordCancelRequests(page, fileId);
    const main = await openDetails(page, fileId, fileName);

    const trigger = main.getByRole('button', {
      name: 'Cancel file',
      exact: true,
    });
    const dialog = page.getByRole('alertdialog', {
      name: `Cancel ${fileName}?`,
    });
    const keepFile = dialog.getByRole('button', {
      name: 'Keep file',
      exact: true,
    });

    // Open by keyboard: "Keep file" is the default (focused) choice.
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(keepFile).toBeFocused();
    await expect(
      dialog.getByRole('button', { name: 'Cancel file', exact: true }),
    ).toBeVisible();

    // Accessibility: the open confirmation.
    await expectNoAxeViolations(page);

    // Enter on the focused "Keep file" closes it; focus returns to the trigger.
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // Open again by keyboard, then Escape closes it.
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(keepFile).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // Nothing was sent and the file is unchanged, also after a reload.
    expect(cancelRequests).toEqual([]);
    await page.reload();
    await expect(main.getByRole('heading', { name: fileName })).toBeVisible();
    await expect(main.getByText('This file was cancelled')).toHaveCount(0);
    await expect(
      main.getByRole('button', { name: 'Download original' }),
    ).toBeVisible();
    await expect(trigger).toBeVisible();
  });

  // AC-3
  test('confirming cancels the file: a self-closing message, cancelled by whom and when, zero transactions, no download', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const fileId = DASHBOARD_FILE_IDS.invalidRows;
    const fileName = 'april-invalid-rows.csv';
    await signInAs(
      page,
      context,
      'Importer',
      baseURL ?? 'http://localhost:3000',
      testInfo,
    );
    const cancelRequests = recordCancelRequests(page, fileId);
    const main = await openDetails(page, fileId, fileName);
    await expect(
      main.getByRole('button', { name: 'Download original' }),
    ).toBeVisible();

    await cancelFromDetails(page, main, fileId, fileName);

    // One request, with no body.
    expect(cancelRequests).toEqual(['']);

    // The confirmation names only the file.
    const toast = cancelledToast(page, fileName);
    await expect(toast).toBeVisible();

    // The details show it cancelled at once, without a reload.
    const cancelledNotice = new RegExp(`Cancelled on .+ by ${SEEDED_UPLOADER}`);
    await expect(main.getByText('This file was cancelled')).toBeVisible();
    await expect(main.getByText(cancelledNotice)).toBeVisible();
    for (const status of ['Imported', 'Approved', 'Rejected']) {
      await expect(
        main.getByText(`0 ${status}`, { exact: true }),
      ).toBeVisible();
    }
    await expect(
      main.getByRole('button', { name: 'Download original' }),
    ).toHaveCount(0);
    await expect(
      main.getByRole('button', { name: 'Cancel file', exact: true }),
    ).toHaveCount(0);

    // Accessibility: the cancelled details with the confirmation showing.
    await expectNoAxeViolations(page);

    // The message closes by itself.
    await expect(toast).toBeHidden({ timeout: 15_000 });

    // The cancel was kept: a reload still shows it cancelled.
    await page.reload();
    await expect(main.getByRole('heading', { name: fileName })).toBeVisible();
    await expect(main.getByText(cancelledNotice)).toBeVisible();
    await expect(
      main.getByRole('button', { name: 'Download original' }),
    ).toHaveCount(0);
  });

  // AC-4
  test('after cancelling, the file leaves the default Dashboard list and shows, marked Cancelled, under "Cancelled files"', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const fileId = DASHBOARD_FILE_IDS.invalidRows;
    const fileName = 'april-invalid-rows.csv';
    await signInAs(
      page,
      context,
      'Importer',
      baseURL ?? 'http://localhost:3000',
      testInfo,
    );

    // Before: listed among the active files.
    await page.goto('/dashboard');
    await expect(fileRow(page, fileName)).toHaveCount(1);

    const main = await openDetails(page, fileId, fileName);
    await cancelFromDetails(page, main, fileId, fileName);
    await expect(main.getByText('This file was cancelled')).toBeVisible();

    // Default (Active) list: gone, 8 files left.
    await page.goto('/dashboard');
    // File-name links only: an Importer also sees "Correct <file name>" shortcuts.
    const names = filesTable(page).getByRole('link', {
      name: /^(?!Correct ).+\.csv$/,
    });
    await expect(names).toHaveCount(8);
    await expect(fileRow(page, fileName)).toHaveCount(0);

    // Show cancelled files: listed and marked Cancelled.
    await page.getByRole('combobox', { name: 'Show' }).click();
    await page
      .getByRole('option', { name: 'Cancelled files', exact: true })
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('visibility'))
      .toBe('Cancelled');
    await expect(names).toHaveCount(4);
    await expect(fileRow(page, fileName)).toHaveCount(1);
    await expect(fileRow(page, fileName)).toContainText('Cancelled');
  });

  // AC-5
  test("cancelling a file with approved transactions is refused with the server's explanation, which stays until dismissed, and the file stays active", async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const fileId = DASHBOARD_FILE_IDS.aprilBatch1;
    const fileName = 'april-batch-1.csv';
    const refusal = cannotCancelMessage(6);
    // Control time so "stays until dismissed" is checked past the 5 s auto-close.
    await page.clock.install();
    await signInAs(
      page,
      context,
      'Importer',
      baseURL ?? 'http://localhost:3000',
      testInfo,
    );
    const main = await openDetails(page, fileId, fileName);

    await main
      .getByRole('button', { name: 'Cancel file', exact: true })
      .click();
    const dialog = page.getByRole('alertdialog', {
      name: `Cancel ${fileName}?`,
    });
    await expect(dialog).toBeVisible();
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === `/api/files/${fileId}/cancel`,
    );
    await dialog
      .getByRole('button', { name: 'Cancel file', exact: true })
      .click();
    expect((await response).status()).toBe(409);

    // The dialog closes and the problem shows the back-end's message verbatim.
    await expect(dialog).toBeHidden();
    const problem = page
      .getByRole('region', { name: 'Notifications' })
      .getByRole('alert')
      .filter({ hasText: refusal });
    await expect(problem).toBeVisible();
    await expect(problem).toContainText('Problem');

    // Accessibility: the details with the refusal showing.
    await expectNoAxeViolations(page);

    // It does not close by itself.
    await page.clock.fastForward('00:20');
    await expect(problem).toBeVisible();

    // The file stays active.
    await expect(main.getByText('This file was cancelled')).toHaveCount(0);
    await expect(main.getByRole('link', { name: /6 Approved/ })).toBeVisible();
    await expect(
      main.getByRole('button', { name: 'Download original' }),
    ).toBeVisible();
    await expect(
      main.getByRole('button', { name: 'Cancel file', exact: true }),
    ).toBeVisible();

    // Dismissing it closes it.
    await problem.getByRole('button', { name: 'Dismiss message' }).click();
    await expect(problem).toBeHidden();
  });
});
