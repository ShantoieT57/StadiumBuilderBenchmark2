/**
 * Story Metadata:
 * - Route: /dashboard/files/[fileId]/corrections
 * - Target File: app-frontend/src/app/(authenticated)/dashboard/files/[fileId]/corrections/page.tsx
 * - Page Action: create_new
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked. This spec never contacts a live backend and uses no
 *   real credentials. Sign-in is faked by adding `txn_session=mockSessionValue('Importer')`
 *   with `context.addCookies()`.
 * - Node side: the shared mock back-end (e2e/fixtures/mock-backend.ts, started by
 *   e2e/global-setup.ts, used by the Next server via BACKEND_URL). It answers GET auth/me,
 *   GET files/{id}, GET/PATCH files/{id}/invalid-rows and POST files/{id}/recheck with real
 *   semantics over the seeded files 06 (april-invalid-rows.csv) and 11 (Q1-Adjustments.csv).
 * - Every test sets its own `mock-run` cookie (MOCK_RUN_COOKIE = mockRunValue(testInfo)) so
 *   its saves / re-checks are kept for the reads that follow and never leak to other tests.
 * - Browser side: same-origin `/api/files/...` calls pass through the Next `/api` proxy to
 *   that mock. `/api/events` is fulfilled with `page.route()` as an idle SSE stream. AC-4's
 *   server refusal fulfils ONE `POST /api/files/<id>/recheck` with `page.route()` (a 400
 *   ValidationProblem keyed `corrections[0].amount`), since the mock never refuses values.
 * - Implementation pattern this assumes:
 *   - The file's details (`/dashboard/files/<id>`) offer a link named "Correct invalid rows"
 *     to `/dashboard/files/<id>/corrections` for an Importer on a Failed + InvalidRows file.
 *   - The correction screen loads `getFile` + `getInvalidRows` from the BROWSER (so the
 *     /api proxy forwards the `mock-run` cookie), shows the file name, its status in words,
 *     a heading "Invalid rows" and the text "<N> rows still need correcting".
 *   - Each row is a `<section aria-labelledby>` (role region) named "Row <rowNumber>", listing
 *     its reasons in words and seven inputs labelled Reference, Transaction date, Account
 *     number, Description, Amount, Transaction type, Currency (required ones may add " *").
 *   - Buttons "Save changes" (PATCH invalid-rows, success toast "Changes saved.") and
 *     "Check again" (POST recheck). Completed -> toast "<file name> has been checked again
 *     and loaded." (auto-dismisses) and navigation to `/dashboard/files/<id>`. Still Failed ->
 *     only the still-failing rows, and a `role=status` region announcing the new count.
 *   - A 400 field key `corrections[i].<field>` is shown under the i-th SENT row's field,
 *     linked by `aria-describedby`. Toasts live in the region "Notifications".
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Seeded facts used (generated-docs/epics/file-correction-and-cancel/mock-facts.md):
 *   - 06 april-invalid-rows.csv: row 4 (date "2026/13/45 08:04", account empty) and row 11
 *     (amount "-509.75"). Passes with row 4 date "2026/04/04 08:04" + account
 *     "1001-2034-5567" and row 11 amount "509.75" -> Completed, 15 Imported. Fixing only
 *     row 4 -> stays Failed with 1 row listed.
 *   - 11 Q1-Adjustments.csv: rows 3, 5, 7 invalid; row 5 type "X" (Invalid Transaction Type).
 *
 * E2E spec for Epic file-correction-and-cancel, Story 1: Correct invalid rows and check again.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type { BrowserContext, Locator, Page, TestInfo } from '@playwright/test';
import type { ValidationProblem } from '../src/types/api-generated';
import {
  MOCK_RUN_COOKIE,
  mockRunValue,
  mockSessionValue,
  SESSION_COOKIE,
} from './fixtures/mock-backend';
import { DASHBOARD_FILE_IDS } from '../src/mocks/data/files';
import {
  INVALID_AMOUNT,
  INVALID_TRANSACTION_DATE,
  INVALID_TRANSACTION_TYPE,
  MISSING_ACCOUNT_NUMBER,
} from '../src/mocks/data/invalidRows';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const IDLE_STREAM = 'retry: 600000\n: connected\n\n';

const FILE_06 = DASHBOARD_FILE_IDS.invalidRows;
const FILE_06_NAME = 'april-invalid-rows.csv';
const FILE_11 = DASHBOARD_FILE_IDS.mixedCaseInvalid;
const FILE_11_NAME = 'Q1-Adjustments.csv';

const SERVER_AMOUNT_MESSAGE = 'Amount is larger than the bank allows.';
/** Passes the browser's amount rule (16 whole digits max); the mocked server refuses it. */
const SERVER_REFUSED_AMOUNT = '9999999999999999.99';

test.use({ timezoneId: 'Africa/Johannesburg' });

/** Signs in as the Importer, names this test's mock run, and stubs the event stream. */
async function signInAsImporter(
  page: Page,
  context: BrowserContext,
  baseURL: string,
  testInfo: TestInfo,
): Promise<void> {
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: mockSessionValue('Importer'),
      url: baseURL,
      httpOnly: true,
      sameSite: 'Lax',
    },
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

/** Opens the file's details and follows "Correct invalid rows". */
async function openCorrections(
  page: Page,
  fileId: string,
  fileName: string,
): Promise<void> {
  await page.goto(`/dashboard/files/${fileId}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: fileName })).toBeVisible();
  await main.getByRole('link', { name: 'Correct invalid rows' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/files/${fileId}/corrections$`),
  );
  await expect(
    main.getByRole('heading', { name: 'Invalid rows' }),
  ).toBeVisible();
}

/** The card of row `rowNumber` on the correction screen. */
function rowCard(page: Page, rowNumber: number): Locator {
  return page
    .getByRole('main')
    .getByRole('region', { name: `Row ${rowNumber}`, exact: true });
}

/** A labelled field inside a row card (labels may carry a required " *"). */
function field(card: Locator, label: string): Locator {
  return card.getByLabel(new RegExp(`^${label}\\b`));
}

/** A toast inside the "Notifications" region. */
function toast(page: Page, text: string): Locator {
  return page
    .getByRole('region', { name: 'Notifications' })
    .getByText(text, { exact: true });
}

/** Waits for the same-origin request `method` to `/api/files/<id>/<suffix>`. */
function apiResponse(
  page: Page,
  method: string,
  fileId: string,
  suffix: string,
) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      new URL(response.url()).pathname === `/api/files/${fileId}/${suffix}`,
  );
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG_21_AA)
    .analyze();
  expect(violations).toEqual([]);
}

test.describe('Epic file-correction-and-cancel, Story 1: Correct invalid rows and check again', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-3
  test('correcting every invalid row and selecting "Check again" loads the file, confirms it and lands on its Completed details', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const base = baseURL ?? 'http://localhost:3000';
    await signInAsImporter(page, context, base, testInfo);
    await openCorrections(page, FILE_06, FILE_06_NAME);

    const main = page.getByRole('main');
    await expect(main.getByText('2 rows still need correcting')).toBeVisible();
    const row4 = rowCard(page, 4);
    const row11 = rowCard(page, 11);
    await expect(row4.getByText(INVALID_TRANSACTION_DATE)).toBeVisible();
    await expect(row4.getByText(MISSING_ACCOUNT_NUMBER)).toBeVisible();
    await expect(row11.getByText(INVALID_AMOUNT)).toBeVisible();

    // Accessibility: the correction screen as opened.
    await expectNoAxeViolations(page);

    await field(row4, 'Transaction date').fill('2026/04/04 08:04');
    await field(row4, 'Account number').fill('1001-2034-5567');
    await field(row11, 'Amount').fill('509.75');

    const recheck = apiResponse(page, 'POST', FILE_06, 'recheck');
    await main.getByRole('button', { name: 'Check again' }).click();
    expect((await recheck).status()).toBe(200);

    const loaded = toast(
      page,
      `${FILE_06_NAME} has been checked again and loaded.`,
    );
    await expect(loaded).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/dashboard/files/${FILE_06}$`));
    await expect(
      main.getByRole('heading', { name: FILE_06_NAME }),
    ).toBeVisible();
    await expect(main).toContainText('Completed');
    await expect(main.getByRole('link', { name: /15 Imported/ })).toBeVisible();
    await expect(
      main.getByRole('link', { name: 'Correct invalid rows' }),
    ).toBeHidden();

    // The confirmation closes by itself.
    await expect(loaded).toBeHidden({ timeout: 15_000 });
  });

  // AC-4
  test('when some rows still fail the file stays Failed with only those rows and the new count, and a server-refused value shows under its field', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const base = baseURL ?? 'http://localhost:3000';
    await signInAsImporter(page, context, base, testInfo);
    await openCorrections(page, FILE_06, FILE_06_NAME);

    const main = page.getByRole('main');
    const row4 = rowCard(page, 4);
    await field(row4, 'Transaction date').fill('2026/04/04 08:04');
    await field(row4, 'Account number').fill('1001-2034-5567');

    const recheck = apiResponse(page, 'POST', FILE_06, 'recheck');
    await main.getByRole('button', { name: 'Check again' }).click();
    expect((await recheck).status()).toBe(200);

    // Still Failed: only row 11 remains, with its reason and the new count.
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/files/${FILE_06}/corrections$`),
    );
    await expect(
      main.getByRole('status').filter({ hasText: /still needs? correcting/ }),
    ).toHaveText(/^1 rows? still needs? correcting$/);
    await expect(rowCard(page, 4)).toBeHidden();
    const row11 = rowCard(page, 11);
    await expect(row11.getByText(INVALID_AMOUNT)).toBeVisible();
    await expect(main).toContainText('Failed');

    // The server refuses the next value: its problem lands under row 11's Amount.
    const refusal: ValidationProblem = {
      title: 'One or more validation errors occurred.',
      status: 400,
      errors: { 'corrections[0].amount': [SERVER_AMOUNT_MESSAGE] },
    };
    await page.route(
      `**/api/files/${FILE_06}/recheck`,
      (route) =>
        route.fulfill({
          status: 400,
          contentType: 'application/problem+json',
          body: JSON.stringify(refusal),
        }),
      { times: 1 },
    );

    // A value the browser accepts (at most 16 whole digits, the back-end's
    // numeric(18,2) limit), so the check is sent and the SERVER refuses it.
    const amount = field(row11, 'Amount');
    await amount.fill(SERVER_REFUSED_AMOUNT);
    await main.getByRole('button', { name: 'Check again' }).click();

    await expect(row11.getByText(SERVER_AMOUNT_MESSAGE)).toBeVisible();
    await expect(amount).toHaveAccessibleDescription(
      new RegExp(SERVER_AMOUNT_MESSAGE.replace(/\./g, '\\.')),
    );
    await expect(amount).toHaveValue(SERVER_REFUSED_AMOUNT);

    // Accessibility: the still-failing screen with a server field problem shown.
    await expectNoAxeViolations(page);
  });

  // AC-5
  test('"Save changes" keeps the edits without checking again, so reopening the screen shows the saved values with the last reasons', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const base = baseURL ?? 'http://localhost:3000';
    await signInAsImporter(page, context, base, testInfo);
    await openCorrections(page, FILE_11, FILE_11_NAME);

    const main = page.getByRole('main');
    await expect(main.getByText('3 rows still need correcting')).toBeVisible();
    const row5 = rowCard(page, 5);
    await expect(field(row5, 'Transaction type')).toHaveValue('X');

    await field(row5, 'Transaction type').fill('C');

    const save = apiResponse(page, 'PATCH', FILE_11, 'invalid-rows');
    await main.getByRole('button', { name: 'Save changes' }).click();
    expect((await save).status()).toBe(200);
    await expect(toast(page, 'Changes saved.')).toBeVisible();

    // Accessibility: the screen right after saving, with the confirmation open.
    await expectNoAxeViolations(page);

    // Leave, then reopen from the details: the file was not checked again.
    await page.getByRole('link', { name: 'Back to file details' }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/files/${FILE_11}$`));
    await expect(main).toContainText('Failed');

    await openCorrections(page, FILE_11, FILE_11_NAME);
    await expect(main.getByText('3 rows still need correcting')).toBeVisible();
    const reopened = rowCard(page, 5);
    await expect(field(reopened, 'Transaction type')).toHaveValue('C');
    await expect(reopened.getByText(INVALID_TRANSACTION_TYPE)).toBeVisible();
  });
});
