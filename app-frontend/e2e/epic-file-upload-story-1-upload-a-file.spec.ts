/**
 * Story Metadata:
 * - Route: /upload
 * - Target File: app-frontend/src/app/(authenticated)/upload/page.tsx
 * - Page Action: modify_existing
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked. This spec never contacts a live backend and uses no
 *   real credentials. Sign-in is faked by adding `txn_session=mockSessionValue('Importer')`
 *   with `context.addCookies()`.
 * - Node side: the shared stateless mock back-end (e2e/fixtures/mock-backend.ts, started by
 *   e2e/global-setup.ts, used by the Next server via BACKEND_URL). It answers GET auth/me,
 *   POST files (multipart; 201 UploadedFile with a new UUID, status Uploaded, for a valid
 *   `.csv` under the 1 MB mock limit) and GET files/{id} for the just-uploaded id (status
 *   Uploaded, never processed) so "View file details" works.
 * - Browser side: the upload is a same-origin `POST /api/files` that passes through the
 *   Next `/api` proxy to that mock (not intercepted here). Only `/api/events` is fulfilled
 *   with `page.route()`, as an idle SSE stream.
 * - Implementation pattern this assumes:
 *   - The upload is sent from the browser (XMLHttpRequest with upload progress) to the
 *     same-origin `/api/files` as multipart/form-data with fields `file` and
 *     `kind=BankTransactions` - never to the back-end address directly.
 *   - The page shows a drop area marked `data-testid="upload-drop-area"` that accepts a
 *     dropped file (dragenter / dragover / drop with a DataTransfer), a `button` named
 *     "Choose file" that opens the browser's file chooser (a visually hidden
 *     `<input type="file" accept=".csv">`, no `multiple`), and a `button` named exactly
 *     "Upload".
 *   - Once chosen, the file's name is shown once as text inside `<main>` with a `button`
 *     whose name starts with "Remove"; removing it clears the name.
 *   - On 201 a success toast (inside the region "Notifications") reads
 *     "<file name> has been uploaded successfully." and goes away by itself (5 s default);
 *     a link "View file details" stays on the page and opens `/dashboard/files/<id>`.
 *   - The file details page shows the file name as a heading and "Uploaded" in words.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * E2E spec for Epic file-upload, Story 1: Upload a file with progress and confirmation.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { UploadedFile, UserRole } from '../src/types/api-generated';
import { mockSessionValue, SESSION_COOKIE } from './fixtures/mock-backend';
import { UPLOADED_FILE_NAME } from '../src/mocks/data/uploads';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const IDLE_STREAM = 'retry: 600000\n: connected\n\n';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** A small in-memory CSV (well under the 1 MB mock limit; no real account numbers). */
const CSV_CONTENT = [
  'TransactionDate,Reference,AccountNumber,Description,Amount,Currency,TransactionType',
  '2026-04-15,TXN-20260415-0001,0000000001,Mock row,100.00,ZAR,Credit',
  '',
].join('\n');

function csvFile(name: string): {
  name: string;
  mimeType: string;
  buffer: Buffer;
} {
  return { name, mimeType: 'text/csv', buffer: Buffer.from(CSV_CONTENT) };
}

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

/** Press Tab until `target` has focus. Returns whether it was reached. */
async function tabUntilFocused(
  page: Page,
  target: Locator,
  maxPresses = 60,
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

/** How far the page scrolls sideways (0 = no horizontal scroll). */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG_21_AA)
    .analyze();
  expect(violations).toEqual([]);
}

/** Drops an in-memory `.csv` file named `name` onto `target` via a DataTransfer. */
async function dropFile(
  page: Page,
  target: Locator,
  name: string,
): Promise<void> {
  const dataTransfer = await page.evaluateHandle(
    ({ fileName, content }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([content], fileName, { type: 'text/csv' }));
      return dt;
    },
    { fileName: name, content: CSV_CONTENT },
  );
  await target.dispatchEvent('dragenter', { dataTransfer });
  await target.dispatchEvent('dragover', { dataTransfer });
  await target.dispatchEvent('drop', { dataTransfer });
}

/** The success toast for `fileName`. */
function successToast(page: Page, fileName: string): Locator {
  return page
    .getByRole('region', { name: 'Notifications' })
    .getByText(`${fileName} has been uploaded successfully.`, { exact: true });
}

/** Waits for the same-origin POST /api/files answer. */
function uploadResponse(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'POST' &&
      url.origin === origin &&
      url.pathname === '/api/files'
    );
  });
}

test.describe('Epic file-upload, Story 1: Upload a file with progress and confirmation', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-2
  test('choosing a file with "Choose file" by keyboard, or dropping one on the drop area, shows its name ready to upload', async ({
    page,
    context,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';
    await signInAs(page, context, 'Importer', base);
    await page.goto('/upload');

    const main = page.getByRole('main');
    const chooseFile = main.getByRole('button', { name: 'Choose file' });
    const uploadButton = main.getByRole('button', {
      name: 'Upload',
      exact: true,
    });
    await expect(chooseFile).toBeVisible();

    // Accessibility: the empty Upload screen.
    await expectNoAxeViolations(page);

    // Keyboard: Tab to "Choose file", press Enter, pick the file in the chooser.
    const keyboardName = 'keyboard-choice_2026-04-15.csv';
    expect(await tabUntilFocused(page, chooseFile)).toBe(true);
    const chooserPromise = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    const chooser = await chooserPromise;
    expect(chooser.isMultiple()).toBe(false);
    await chooser.setFiles(csvFile(keyboardName));

    await expect(main.getByText(keyboardName)).toBeVisible();
    const remove = main.getByRole('button', { name: /^Remove/ });
    await expect(remove).toBeVisible();
    await expect(uploadButton).toBeEnabled();

    // Accessibility: a file chosen and ready to upload.
    await expectNoAxeViolations(page);

    // Remove it, then drop another file onto the drop area instead.
    await remove.click();
    await expect(main.getByText(keyboardName)).toBeHidden();

    const droppedName = 'dropped-file_2026-04-15.csv';
    const dropArea = page.getByTestId('upload-drop-area');
    await expect(dropArea).toBeVisible();
    await dropFile(page, dropArea, droppedName);

    await expect(main.getByText(droppedName)).toBeVisible();
    await expect(main.getByRole('button', { name: /^Remove/ })).toBeVisible();
    await expect(uploadButton).toBeEnabled();
  });

  // AC-4
  test('a finished upload confirms "<file name> has been uploaded successfully.", the message goes by itself, and "View file details" opens that file', async ({
    page,
    context,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3000';
    await signInAs(page, context, 'Importer', base);
    await page.goto('/upload');

    const main = page.getByRole('main');
    await expect(
      main.getByRole('button', { name: 'Choose file' }),
    ).toBeVisible();
    await main
      .locator('input[type="file"]')
      .setInputFiles(csvFile(UPLOADED_FILE_NAME));
    await expect(main.getByText(UPLOADED_FILE_NAME)).toBeVisible();

    const responsePromise = uploadResponse(page, base);
    await main.getByRole('button', { name: 'Upload', exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    const uploaded = (await response.json()) as UploadedFile;
    expect(uploaded.id).toMatch(UUID);

    // The confirmation shows, then goes away on its own.
    const toast = successToast(page, UPLOADED_FILE_NAME);
    await expect(toast).toBeVisible();

    // Accessibility: the screen after a successful upload, with the confirmation open.
    await expectNoAxeViolations(page);

    await expect(toast).toBeHidden({ timeout: 15_000 });

    // "View file details" stays on the page and opens the uploaded file.
    await main.getByRole('link', { name: 'View file details' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/files/${uploaded.id}$`),
    );
    const details = page.getByRole('main');
    await expect(
      details.getByRole('heading', { name: UPLOADED_FILE_NAME }),
    ).toBeVisible();
    await expect(details).toContainText('Uploaded');
  });

  // AC-6
  test('at 360px the Upload screen has no horizontal scroll and choosing and uploading a file works by keyboard alone', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const base = baseURL ?? 'http://localhost:3000';
    await signInAs(page, context, 'Importer', base);
    await page.goto('/upload');

    const main = page.getByRole('main');
    const chooseFile = main.getByRole('button', { name: 'Choose file' });
    await expect(chooseFile).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);

    // A long name must wrap rather than push the page sideways.
    const longName =
      'transactions_2026-04-15_daily-export-from-the-bank-branch-network-north-region-batch-0001.csv';

    // Keyboard only: Tab to "Choose file", Enter, pick the file.
    expect(await tabUntilFocused(page, chooseFile)).toBe(true);
    const chooserPromise = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    const chooser = await chooserPromise;
    await chooser.setFiles(csvFile(longName));

    await expect(main.getByText(longName)).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);

    // Accessibility: the phone layout with a long file name chosen.
    await expectNoAxeViolations(page);

    // Keyboard only: Tab to "Upload" and press Enter.
    const uploadButton = main.getByRole('button', {
      name: 'Upload',
      exact: true,
    });
    expect(await tabUntilFocused(page, uploadButton)).toBe(true);
    const responsePromise = uploadResponse(page, base);
    await page.keyboard.press('Enter');
    expect((await responsePromise).status()).toBe(201);

    await expect(successToast(page, longName)).toBeVisible();
    await expect(
      main.getByRole('link', { name: 'View file details' }),
    ).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
  });
});
