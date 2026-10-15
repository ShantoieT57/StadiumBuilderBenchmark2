/**
 * Story Metadata:
 * - Route: /upload
 * - Target File: app-frontend/src/app/(authenticated)/upload/page.tsx
 * - Page Action: modify_existing
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked. This spec never contacts a live backend and uses no
 *   real credentials.
 * - Sign-in uses a mock session cookie, `txn_session=mockSessionValue('Importer')`, added
 *   with `context.addCookies()`.
 * - The shared Node-side mock back-end (e2e/fixtures/mock-backend.ts, started by
 *   global-setup.ts) answers everything else. The server-side `GET /api/auth/me` goes to it,
 *   and the browser-side `POST /api/files` goes through the Next.js `/api` proxy to it.
 *   Its connection-drop hook: a `.csv` whose name starts `drop-once-` has its FIRST upload
 *   dropped (the proxy then answers 502, a network failure) and every later upload of the
 *   same name answered 201. Each test uses a name unique to the test and retry.
 * - In the browser, `page.route()` stubs only `/api/events`, with an idle SSE stream.
 * - Implementation pattern this assumes:
 *   - The Upload form's "Choose file" button opens the browser's file chooser (a visually
 *     hidden `<input type="file" accept=".csv">`), and sits INSIDE the drop area, so a
 *     `drop` event dispatched on it bubbles to the drop area's handler.
 *   - The `.csv` and several-files checks run in the browser on choose/drop, before any
 *     request: no `POST /api/files` is sent for them.
 *   - Refusals and failures show inline as `role="alert"` with the exact wording from
 *     src/mocks/data/uploads.ts; a refused file is cleared (its name is not shown).
 *   - A network failure (proxy 502) shows "The upload of <file name> failed. Check your
 *     connection and try again." with a "Try again" button that re-sends the same file;
 *     success then shows "<file name> has been uploaded successfully." (story 1).
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * E2E spec for Epic file-upload, Story 2: Refused files and failed uploads.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type { BrowserContext, Page, Request } from '@playwright/test';
import {
  NOT_CSV_MESSAGE,
  ONE_FILE_AT_A_TIME_MESSAGE,
} from '../src/mocks/data/uploads';
import { mockSessionValue, SESSION_COOKIE } from './fixtures/mock-backend';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const IDLE_STREAM = 'retry: 600000\n: connected\n\n';
const CSV_CONTENT =
  'Reference,TransactionDate,AccountNumber\r\nREF-1,2026-04-15,123\r\n';

async function signInAsImporter(
  page: Page,
  context: BrowserContext,
  baseURL: string,
): Promise<void> {
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: mockSessionValue('Importer'),
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

async function expectNoAxeViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG_21_AA)
    .analyze();
  expect(violations).toEqual([]);
}

/** Records every `POST /api/files` the page sends, so a spec can prove none was sent. */
function recordUploads(page: Page): string[] {
  const uploads: string[] = [];
  page.on('request', (request: Request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/files'
    ) {
      uploads.push(request.url());
    }
  });
  return uploads;
}

/** Chooses one file through the "Choose file" button and the browser's file chooser. */
async function chooseFile(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Choose file' })
    .click();
  await (await chooser).setFiles(file);
}

/** Drops `names` (as .csv files) onto the drop area in a single drop. */
async function dropFiles(page: Page, names: string[]): Promise<void> {
  const dataTransfer = await page.evaluateHandle(
    ({ fileNames, content }) => {
      const transfer = new DataTransfer();
      for (const name of fileNames) {
        transfer.items.add(new File([content], name, { type: 'text/csv' }));
      }
      return transfer;
    },
    { fileNames: names, content: CSV_CONTENT },
  );
  const target = page
    .getByRole('main')
    .getByRole('button', { name: 'Choose file' });
  await target.dispatchEvent('dragenter', { dataTransfer });
  await target.dispatchEvent('dragover', { dataTransfer });
  await target.dispatchEvent('drop', { dataTransfer });
}

test.describe('Epic file-upload, Story 2: Refused files and failed uploads', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1
  test('a file that is not a .csv is refused before uploading, and another file can then be chosen', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsImporter(page, context, baseURL ?? 'http://localhost:3000');
    const uploads = recordUploads(page);

    await page.goto('/upload');
    const main = page.getByRole('main');
    await expect(
      main.getByRole('button', { name: 'Choose file' }),
    ).toBeVisible();

    await chooseFile(page, {
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a csv file'),
    });

    const refusal = page
      .getByRole('alert')
      .filter({ hasText: NOT_CSV_MESSAGE });
    await expect(refusal).toBeVisible();
    await expect(main.getByText('notes.txt')).toHaveCount(0);
    expect(uploads).toEqual([]);

    await expectNoAxeViolations(page);

    // The Importer chooses another file: it is ready to upload and the refusal goes away.
    await chooseFile(page, {
      name: 'transactions_2026-04-15.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(CSV_CONTENT),
    });
    await expect(main.getByText('transactions_2026-04-15.csv')).toBeVisible();
    await expect(refusal).toHaveCount(0);
    expect(uploads).toEqual([]);
  });

  // AC-3
  test('dropping several files at once is refused and nothing is uploaded', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsImporter(page, context, baseURL ?? 'http://localhost:3000');
    const uploads = recordUploads(page);

    await page.goto('/upload');
    const main = page.getByRole('main');
    await expect(
      main.getByRole('button', { name: 'Choose file' }),
    ).toBeVisible();

    await dropFiles(page, ['april-first.csv', 'april-second.csv']);

    await expect(
      page.getByRole('alert').filter({ hasText: ONE_FILE_AT_A_TIME_MESSAGE }),
    ).toBeVisible();
    await expect(main.getByText('april-first.csv')).toHaveCount(0);
    await expect(main.getByText('april-second.csv')).toHaveCount(0);
    expect(uploads).toEqual([]);

    await expectNoAxeViolations(page);
  });

  // AC-5
  test('an upload whose connection drops says it failed, and Try again uploads the same file and confirms it', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    // The mock drops the first upload of a `drop-once-` name and accepts the next one.
    const fileName = `drop-once-${testInfo.testId}-${testInfo.retry}.csv`;
    await signInAsImporter(page, context, baseURL ?? 'http://localhost:3000');

    await page.goto('/upload');
    const main = page.getByRole('main');

    await chooseFile(page, {
      name: fileName,
      mimeType: 'text/csv',
      buffer: Buffer.from(CSV_CONTENT),
    });
    await expect(main.getByText(fileName)).toBeVisible();
    await main.getByRole('button', { name: 'Upload', exact: true }).click();

    const failure = page.getByRole('alert').filter({
      hasText: `The upload of ${fileName} failed. Check your connection and try again.`,
    });
    await expect(failure).toBeVisible();
    const tryAgain = main.getByRole('button', { name: 'Try again' });
    await expect(tryAgain).toBeVisible();

    await expectNoAxeViolations(page);

    const retried = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/files',
    );
    await tryAgain.click();
    const response = await retried;
    expect(response.status()).toBe(201);
    expect(response.request().postDataBuffer()?.toString('utf8')).toContain(
      `filename="${fileName}"`,
    );

    // The toast and the status region may both carry the confirmation; either is enough.
    await expect(
      page.getByText(`${fileName} has been uploaded successfully.`).first(),
    ).toBeVisible();
    await expect(failure).toHaveCount(0);
  });
});
