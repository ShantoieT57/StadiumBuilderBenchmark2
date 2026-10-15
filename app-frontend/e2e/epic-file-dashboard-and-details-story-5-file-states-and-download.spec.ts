/**
 * Story Metadata:
 * - Route: /dashboard/files/[fileId]
 * - Target File: app-frontend/src/app/(authenticated)/dashboard/files/[fileId]/page.tsx
 * - Page Action: modify_existing
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked. This spec never contacts a live backend and uses no
 *   real credentials.
 * - Sign-in uses a mock session cookie, `txn_session=mockSessionValue(<Role>)`, added with
 *   `context.addCookies()`.
 * - The shared Node-side mock back-end (e2e/fixtures/mock-backend.ts, started by
 *   global-setup.ts) answers everything else. The server-side `GET /api/auth/me` goes to it.
 *   Browser-side `GET /api/files/{id}` and `GET /api/files/{id}/content` go through the
 *   Next.js `/api` proxy to it too. The content endpoint answers `text/csv` with
 *   `Content-Disposition: attachment; filename=...; filename*=UTF-8''...`.
 * - In the browser, `page.route()` stubs only `/api/events`, with an idle SSE stream.
 * - Implementation pattern this assumes:
 *   - The details page loads `getFile(id)` from the browser through the `/api` proxy and
 *     shows the file name inside `<main>`.
 *   - A labelled button "Download original" fetches `/api/files/{id}/content` through the
 *     API client (same-origin proxy, never the back-end directly), then saves the Blob via
 *     a temporary object URL + `<a download="<fileName>">`, so Playwright sees a `download`
 *     event whose suggested file name is the original file name.
 *   - The CSV content is never rendered in the page; the page stays on the details URL.
 *   - Success shows a self-closing "Download started" message (useToast).
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * E2E spec for Epic file-dashboard-and-details, Story 5: File states and download.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { readFile } from 'node:fs/promises';

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type { BrowserContext, Page } from '@playwright/test';
import type { UserRole } from '../src/types/api-generated';
import {
  DASHBOARD_FILE_IDS,
  fileContentFor,
  seedDashboardFileDetails,
} from '../src/mocks/data/files';
import { mockSessionValue, SESSION_COOKIE } from './fixtures/mock-backend';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const IDLE_STREAM = 'retry: 600000\n: connected\n\n';

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

async function expectNoAxeViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG_21_AA)
    .analyze();
  expect(violations).toEqual([]);
}

test.describe('Epic file-dashboard-and-details, Story 5: File states and download', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1
  test('Download original saves the file under its original name without showing its contents', async ({
    page,
    context,
    baseURL,
  }) => {
    const fileId = DASHBOARD_FILE_IDS.aprilBatch1;
    const file = seedDashboardFileDetails().find((f) => f.id === fileId);
    if (!file)
      throw new Error(`Seeded file ${fileId} is missing from the mock data`);
    const expectedContent = fileContentFor(file);
    const firstDataRow = expectedContent.split('\r\n')[1].split(',')[0]; // e.g. APRIL-BATCH-1-0001

    await signInAs(
      page,
      context,
      'Approver',
      baseURL ?? 'http://localhost:3000',
    );

    const detailsUrl = `/dashboard/files/${fileId}`;
    await page.goto(detailsUrl);
    const main = page.getByRole('main');
    await expect(main).toContainText('april-batch-1.csv');

    const downloadButton = main.getByRole('button', {
      name: 'Download original',
    });
    await expect(downloadButton).toBeVisible();
    await expectNoAxeViolations(page);

    // The download goes through the same-origin /api proxy, not the back-end directly.
    const contentRequest = page.waitForRequest(
      (request) =>
        request.method() === 'GET' &&
        new URL(request.url()).pathname === `/api/files/${fileId}/content`,
    );
    const downloadEvent = page.waitForEvent('download');
    await downloadButton.click();
    await contentRequest;
    const download = await downloadEvent;

    expect(download.suggestedFilename()).toBe('april-batch-1.csv');
    const savedPath = await download.path();
    expect(await readFile(savedPath, 'utf8')).toBe(expectedContent);

    await expect(page.getByText('Download started')).toBeVisible();

    // The contents are never shown in the page, and the user stays on the details screen.
    await expect(page).toHaveURL(new RegExp(`${detailsUrl}$`));
    await expect(page.getByText(firstDataRow)).toHaveCount(0);
    await expect(
      page.getByText(/Reference,TransactionDate,AccountNumber/),
    ).toHaveCount(0);
    await expect(main).toContainText('april-batch-1.csv');

    await expectNoAxeViolations(page);
  });
});
