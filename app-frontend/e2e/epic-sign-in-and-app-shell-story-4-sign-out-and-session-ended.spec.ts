/**
 * Story Metadata:
 * - Route: /dashboard
 * - Target File: app-frontend/src/app/(authenticated)/layout.tsx
 *   (sign-out control, events provider in contexts/, app/api/events/route.ts streaming proxy,
 *   401 handling in lib/api/client.ts, reason messages on app/sign-in/page.tsx)
 * - Page Action: modify_existing
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked. This spec never contacts a live backend and uses no
 *   real credentials. Sign-in is faked by seeding the `txn_session` cookie with
 *   `context.addCookies()` (signing in through the form is Story 1's concern).
 * - Two mock layers, both driven by the same cookie convention (e2e/fixtures/mock-backend.ts):
 *   - Node side: the shared stateless mock back-end (started by e2e/global-setup.ts;
 *     playwright.config.ts sets BACKEND_URL=http://127.0.0.1:5199/api on the web server).
 *     `mock-session-<Role>` is an active session; `mock-session-<Role>-<Reason>` is a session
 *     the back-end has ended, so GET auth/me answers 401 `unauthenticatedBody(<Reason>)`.
 *     A test "ends" a session by overwriting the cookie with that value.
 *   - Browser side, via `page.route()`: `/api/auth/me` and `/api/auth/sign-out` answer with
 *     the same `respondFor()` logic (sign-out: 204 + Set-Cookie clearing `txn_session`);
 *     `/api/events` is fulfilled with an SSE body (`retry: 5000` plus, where a test needs it,
 *     `sessionEndedFrame(reason)`); any other `/api/*` call gets 404.
 * - Implementation pattern this assumes:
 *   - Sign out is a button named "Sign out" in the signed-in shell. It calls
 *     `POST /api/auth/sign-out` FROM THE BROWSER, closes the event stream and goes to
 *     `/sign-in`, showing a "You have signed out" success message.
 *   - The live connection is a browser `EventSource` (or fetch) to same-origin `/api/events`,
 *     so page.route() can fulfil it. On `session-ended` it goes to sign-in with the reason.
 *   - The `(authenticated)` server layout forwards the 401 `reason` from GET auth/me into its
 *     redirect (e.g. `/sign-in?reason=SessionExpired`), using the SAME reason-to-message
 *     mapping as the central 401 handler in client.ts.
 *   - Sign-in reason messages: SessionExpired mentions "60 minutes" (inactivity);
 *     SignedInElsewhere mentions "another device". NotSignedIn / SignedOut show none.
 *   - Signed-in pages are `no-store`, and a `pageshow` handler re-checks GET /api/auth/me when
 *     a page is restored from the back/forward cache.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * E2E spec for Epic sign-in-and-app-shell, Story 4: Sign out and being signed out.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type { BrowserContext, Page } from '@playwright/test';
import type {
  UnauthenticatedReason,
  UserRole,
} from '../src/types/api-generated';
// Shared project-wide identity source, imported relatively (not @/) for the Playwright runtime.
import { seededUsers, sessionEndedFrame } from '../src/mocks/data/identity';
import {
  endedSessionValue,
  mockSessionValue,
  respondFor,
} from './fixtures/mock-backend';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SIGN_IN_URL = /\/sign-in(\?.*)?$/;

/** Seed (or overwrite) the `txn_session` cookie. */
async function setSessionCookie(
  context: BrowserContext,
  baseURL: string,
  value: string,
): Promise<void> {
  await context.addCookies([
    {
      name: 'txn_session',
      value,
      url: baseURL,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

/**
 * Mock every browser-side same-origin API call. Later routes win, so the catch-all
 * goes first. `eventsBody` is what `/api/events` streams (an idle stream by default).
 */
async function mockBrowserApi(
  page: Page,
  eventsBody: () => Promise<string> | string,
): Promise<void> {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not mocked in this spec.' }),
    }),
  );
  for (const path of ['/auth/me', '/auth/sign-out']) {
    await page.route(`**/api${path}`, async (route) => {
      const request = route.request();
      const { status, headers, body } = respondFor(
        request.method(),
        path,
        await request.headerValue('cookie'),
      );
      await route.fulfill({ status, headers, body });
    });
  }
  await page.route('**/api/events', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-cache' },
      body: await eventsBody(),
    }),
  );
}

const IDLE_STREAM = 'retry: 5000\n: connected\n\n';

async function openSignedInShell(
  page: Page,
  role: UserRole,
  path: string,
): Promise<void> {
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(
    page.getByRole('banner').getByText(seededUsers[role].name, { exact: true }),
  ).toBeVisible();
}

test.describe('Epic sign-in-and-app-shell, Story 4: Sign out and being signed out', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1
  test('signing out returns to sign-in, and signed-in screens then show sign-in too', async ({
    page,
    context,
    baseURL,
  }) => {
    await setSessionCookie(context, baseURL!, mockSessionValue('Importer'));
    await mockBrowserApi(page, () => IDLE_STREAM);
    await openSignedInShell(page, 'Importer', '/dashboard');

    await page.getByRole('button', { name: /sign out/i }).click();

    await expect(page).toHaveURL(SIGN_IN_URL);
    await expect(page.getByText(/you have signed out/i)).toBeVisible();

    await page.goto('/upload');
    await expect(page).toHaveURL(SIGN_IN_URL);
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(
      page.getByText(seededUsers.Importer.name, { exact: true }),
    ).toHaveCount(0);
  });

  // AC-2
  test('after signing out, the Back button does not show the signed-in page again', async ({
    page,
    context,
    baseURL,
  }) => {
    await setSessionCookie(context, baseURL!, mockSessionValue('Approver'));
    await mockBrowserApi(page, () => IDLE_STREAM);
    await openSignedInShell(page, 'Approver', '/transactions');
    await openSignedInShell(page, 'Approver', '/dashboard');

    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL(SIGN_IN_URL);

    await page.goBack();

    await expect(page).toHaveURL(SIGN_IN_URL);
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(
      page.getByText(seededUsers.Approver.name, { exact: true }),
    ).toHaveCount(0);
  });

  // AC-4
  test('an action rejected because the session expired returns to sign-in with the idle message', async ({
    page,
    context,
    baseURL,
  }) => {
    await setSessionCookie(context, baseURL!, mockSessionValue('Importer'));
    await mockBrowserApi(page, () => IDLE_STREAM);
    await openSignedInShell(page, 'Importer', '/dashboard');

    // The back-end ends the session for inactivity; the next request is rejected with that reason.
    await setSessionCookie(
      context,
      baseURL!,
      endedSessionValue('Importer', 'SessionExpired'),
    );
    await page.goto('/transactions');

    await expect(page).toHaveURL(SIGN_IN_URL);
    const idleMessage = page.getByText(/60 minutes/i);
    await expect(idleMessage).toBeVisible();
    await expect(page.getByText(/another device/i)).toHaveCount(0);

    // Accessibility: the sign-in screen in the persistent session-ended problem state.
    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_21_AA)
      .analyze();
    expect(violations).toEqual([]);
  });

  // AC-5
  test('a session-ended event returns to sign-in with the matching message without any click', async ({
    page,
    context,
    baseURL,
  }) => {
    const reason: UnauthenticatedReason = 'SignedInElsewhere';
    let endSession: () => void = () => undefined;
    const sessionEnded = new Promise<void>((resolve) => {
      endSession = resolve;
    });

    await setSessionCookie(context, baseURL!, mockSessionValue('Approver'));
    // The stream only delivers `session-ended` once the test has ended the session.
    await mockBrowserApi(page, async () => {
      await sessionEnded;
      return `retry: 5000\n\n${sessionEndedFrame(reason)}`;
    });
    await openSignedInShell(page, 'Approver', '/dashboard');

    // The person signs in on another device: the back-end ends this session and pushes the event.
    await setSessionCookie(
      context,
      baseURL!,
      endedSessionValue('Approver', reason),
    );
    endSession();

    await expect(page).toHaveURL(SIGN_IN_URL);
    await expect(page.getByText(/another device/i)).toBeVisible();
    await expect(page.getByText(/60 minutes/i)).toHaveCount(0);
  });
});
