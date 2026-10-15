/**
 * Story Metadata:
 * - Route: /dashboard
 * - Target File: app-frontend/src/app/(authenticated)/dashboard/page.tsx
 * - Page Action: modify_existing
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked. This spec never contacts a live backend and uses no
 *   real credentials.
 * - Sign-in uses a mock session cookie, `txn_session=mockSessionValue(<Role>)`, added with
 *   `context.addCookies()`.
 * - The shared Node-side mock back-end (e2e/fixtures/mock-backend.ts, started by
 *   global-setup.ts) answers everything else: server-side `GET /api/auth/me`, and the
 *   browser-side `GET /api/files`, `GET /api/files/{id}`, `GET /api/files/{id}/invalid-rows`
 *   and `POST /api/files/{id}/recheck`, which go through the Next.js `/api` proxy to it.
 *   invalid-rows answers 403 for an Approver and 409 "This file is not waiting for
 *   corrections." for a file that is not Failed + InvalidRows + not cancelled.
 * - In the browser, `page.route()` stubs only `/api/events`, with an idle SSE stream.
 * - The "cancelled elsewhere" case of AC-4 sets a per-test `mock-run` cookie and cancels the
 *   file by calling the mock back-end DIRECTLY (127.0.0.1:MOCK_BACKEND_PORT) with the same
 *   session + run cookies, standing in for another tab. The browser's next recheck then gets
 *   the real 409 from the mock.
 * - Implementation pattern this assumes:
 *   - Dashboard (Importer only): a link named "Correct <file name>" (visible text "Correct")
 *     in the table's actions cell (>= 768px) and in the compact row's actions after Details
 *     (< 768px), for each Failed + InvalidRows + not-cancelled file, pointing at
 *     `/dashboard/files/<id>/corrections`.
 *   - The correction screen loads `getFile` and `getInvalidRows` FROM THE BROWSER through the
 *     /api proxy, shows the file name, "Row <n>" headings per invalid row, and buttons
 *     "Save changes" and "Check again".
 *   - Approver on the correction URL: `RouteGuard` renders `NoAccess` ("No access" heading,
 *     "... Ask your administrator ...") inside the shell, stays on the URL, and makes no
 *     invalid-rows request.
 *   - Not waiting (409 on open or on Check again): the form is replaced by a notice with the
 *     text "This file is not waiting for corrections." and a link "View file details" to
 *     `/dashboard/files/<id>`.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Seeded facts (generated-docs/epics/file-dashboard-and-details/mock-facts.md and
 * file-correction-and-cancel/mock-facts.md): active Failed + InvalidRows files are
 * 06 april-invalid-rows.csv (rows 4 and 11 invalid) and 11 Q1-Adjustments.csv; 09
 * wrong-bank-format.csv is Failed + InvalidRows but cancelled (invalid-rows answers 409).
 *
 * E2E spec for Epic file-correction-and-cancel, Story 2: Dashboard correction shortcut and
 * who can correct. These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type { BrowserContext, Page } from '@playwright/test';
import type { UserRole } from '../src/types/api-generated';
import { DASHBOARD_FILE_IDS } from '../src/mocks/data/files';
import { NOT_WAITING_FOR_CORRECTIONS_MESSAGE } from '../src/mocks/data/invalidRows';
import {
  MOCK_BACKEND_PORT,
  MOCK_RUN_COOKIE,
  SESSION_COOKIE,
  mockRunValue,
  mockSessionValue,
} from './fixtures/mock-backend';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const IDLE_STREAM = 'retry: 600000\n: connected\n\n';

const INVALID_ROWS_ID = DASHBOARD_FILE_IDS.invalidRows; // 06 april-invalid-rows.csv
const CANCELLED_INVALID_ID = DASHBOARD_FILE_IDS.cancelledFailed; // 09 wrong-bank-format.csv

function correctionsPath(id: string): string {
  return `/dashboard/files/${id}/corrections`;
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

async function expectNoAxeViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG_21_AA)
    .analyze();
  expect(violations).toEqual([]);
}

test.describe('Epic file-correction-and-cancel, Story 2: Dashboard correction shortcut and who can correct', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1
  test('an Importer sees "Correct" on files that failed because of invalid rows and it opens the correction screen, also from the phone layout by keyboard', async ({
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
    await page.goto('/dashboard');

    const table = page.getByRole('table');
    await expect(
      table.getByRole('link', { name: 'april-invalid-rows.csv', exact: true }),
    ).toBeVisible();

    // Only the two active files waiting for corrections carry the shortcut.
    const correctLinks = table.getByRole('link', { name: /^Correct\b/ });
    await expect(correctLinks).toHaveCount(2);
    const correctInvalidRows = table.getByRole('link', {
      name: 'Correct april-invalid-rows.csv',
    });
    await expect(correctInvalidRows).toBeVisible();
    await expect(correctInvalidRows).toHaveText('Correct');
    await expect(
      table.getByRole('link', { name: 'Correct Q1-Adjustments.csv' }),
    ).toBeVisible();

    await expectNoAxeViolations(page);

    await correctInvalidRows.click();
    await expect(page).toHaveURL(
      new RegExp(`${correctionsPath(INVALID_ROWS_ID)}$`),
    );
    const main = page.getByRole('main');
    await expect(main).toContainText('april-invalid-rows.csv');
    await expect(main.getByRole('heading', { name: 'Row 4' })).toBeVisible();
    await expect(
      main.getByRole('button', { name: 'Check again' }),
    ).toBeVisible();

    // Phone width: the shortcut sits in the compact row's actions and works by keyboard.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/dashboard');
    const row = page
      .getByRole('listitem')
      .filter({ hasText: 'april-invalid-rows.csv' });
    const phoneCorrect = row.getByRole('link', {
      name: 'Correct april-invalid-rows.csv',
    });
    await expect(phoneCorrect).toBeVisible();
    await phoneCorrect.focus();
    await expect(phoneCorrect).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(
      new RegExp(`${correctionsPath(INVALID_ROWS_ID)}$`),
    );
  });

  // AC-3
  test('an Approver opening a saved correction link sees the no-access message naming who to ask and no correction controls', async ({
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

    const invalidRowsRequests: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/invalid-rows')) {
        invalidRowsRequests.push(request.url());
      }
    });

    await page.goto(correctionsPath(INVALID_ROWS_ID));

    // Stays on the saved link inside the shell; not a redirect.
    await expect(page).toHaveURL(
      new RegExp(`${correctionsPath(INVALID_ROWS_ID)}$`),
    );
    const main = page.getByRole('main');
    await expect(
      main.getByRole('heading', { name: 'No access' }),
    ).toBeVisible();
    await expect(
      main.getByText(/you don.t have access to this screen/i),
    ).toBeVisible();
    await expect(main.getByText(/ask your administrator/i)).toBeVisible();
    await expect(page.getByRole('navigation')).toBeVisible();

    // No correction controls at all.
    await expect(page.getByRole('button', { name: 'Check again' })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole('button', { name: 'Save changes' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Invalid rows' }),
    ).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: /reference/i })).toHaveCount(
      0,
    );

    await expectNoAxeViolations(page);

    // The screen never asked for the invalid rows.
    expect(invalidRowsRequests).toEqual([]);
  });

  // AC-4
  test('a file no longer waiting for corrections shows the not-waiting notice with a way to its details, on opening and on Check again', async ({
    page,
    context,
    baseURL,
    request,
  }, testInfo) => {
    const url = baseURL ?? 'http://localhost:3000';
    const runValue = mockRunValue(testInfo);
    await signInAs(page, context, 'Importer', url);
    await context.addCookies([{ name: MOCK_RUN_COOKIE, value: runValue, url }]);

    // On opening: a cancelled file (09) answers 409 on invalid-rows.
    await page.goto(correctionsPath(CANCELLED_INVALID_ID));
    const main = page.getByRole('main');
    await expect(
      main.getByText(NOT_WAITING_FOR_CORRECTIONS_MESSAGE),
    ).toBeVisible();
    await expect(
      main.getByRole('link', { name: 'View file details' }),
    ).toHaveAttribute('href', `/dashboard/files/${CANCELLED_INVALID_ID}`);
    await expect(main.getByRole('button', { name: 'Check again' })).toHaveCount(
      0,
    );
    await expect(
      main.getByRole('button', { name: 'Save changes' }),
    ).toHaveCount(0);
    await expect(main.getByRole('textbox', { name: /reference/i })).toHaveCount(
      0,
    );

    await expectNoAxeViolations(page);

    // On Check again: open 06 while it is still waiting...
    await page.goto(correctionsPath(INVALID_ROWS_ID));
    await expect(main.getByRole('heading', { name: 'Row 4' })).toBeVisible();
    const checkAgain = main.getByRole('button', { name: 'Check again' });
    await expect(checkAgain).toBeVisible();

    // ...then it is cancelled elsewhere (another tab), in this test's mock run.
    const cancelled = await request.post(
      `http://127.0.0.1:${MOCK_BACKEND_PORT}/api/files/${INVALID_ROWS_ID}/cancel`,
      {
        headers: {
          cookie: `${SESSION_COOKIE}=${mockSessionValue('Importer')}; ${MOCK_RUN_COOKIE}=${runValue}`,
        },
      },
    );
    expect(cancelled.status()).toBe(200);

    await checkAgain.click();

    // The form is replaced by the notice; edits cannot be sent any more.
    await expect(
      main.getByText(NOT_WAITING_FOR_CORRECTIONS_MESSAGE),
    ).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Row 4' })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Check again' })).toHaveCount(
      0,
    );

    await expectNoAxeViolations(page);

    await main.getByRole('link', { name: 'View file details' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/files/${INVALID_ROWS_ID}$`),
    );
    await expect(page.getByRole('main')).toContainText(
      'april-invalid-rows.csv',
    );
  });
});
