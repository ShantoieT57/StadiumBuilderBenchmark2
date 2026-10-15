/**
 * Story Metadata:
 * - Route: /sign-in
 * - Target File: app-frontend/src/app/sign-in/page.tsx + app-frontend/src/app/(signed-in)/layout.tsx
 * - Page Action: create_new
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked — this spec never contacts the live back-end on :5100.
 *   Two layers, because this story has both browser-side and server-side back-end calls:
 *   - `page.route()` — every browser call to same-origin `/api/*`. A catch-all `/api/**`
 *     answers 404 so an unexpected browser call can never fall through the proxy to :5100.
 *     `POST /api/auth/sign-in` is fulfilled with the seeded user's body and a mock
 *     `txn_session` cookie (`mock-session-<Role>`) via Set-Cookie.
 *   - Node-side mock back-end (e2e/fixtures/mock-backend.ts, started by e2e/global-setup.ts)
 *     — answers the Next.js SERVER's own calls. playwright.config.ts sets
 *     `BACKEND_URL=http://127.0.0.1:5199/api` on the web server; the mock maps the
 *     forwarded `txn_session` cookie back to the role and returns `userInfoFor(role)`,
 *     or 401 `NotSignedIn` when there is no valid cookie.
 * - Implementation pattern this assumes:
 *   - The sign-in form posts from the BROWSER (client-component call through
 *     `@/lib/api/client` to the relative `/api/auth/sign-in`), not a Server Action —
 *     page.route() cannot intercept Server Action requests.
 *   - The `(signed-in)` server layout calls `${process.env.BACKEND_URL}/auth/me` at
 *     request time (read at runtime, not inlined at build), forwarding the incoming
 *     `txn_session` cookie, and calls `redirect('/sign-in')` on 401 BEFORE rendering
 *     anything — so a signed-out visit is a server redirect, never a flash of content.
 *   - `/` redirects to the role's landing page (Importer -> /upload, Approver -> /transactions),
 *     and to /sign-in when signed out.
 *   - The header is a `<header>` (banner landmark) showing the person's name and their
 *     role as separate text (e.g. "File Importer" and "Importer").
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * E2E spec for Epic sign-in-and-app-shell, Story 1: Sign in and land on your screen.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import type { Page } from '@playwright/test';
import type { UserRole } from '../src/types/api-generated';
import {
  seededUsers,
  signInFailureBody,
  unauthenticatedBody,
  userInfoFor,
} from '../src/mocks/data/identity';
import { approverUser, importerUser } from './fixtures/credentials';
import { mockSessionValue, roleFromCookie } from './fixtures/mock-backend';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

function roleForEmail(email: string): UserRole | null {
  if (email === seededUsers.Importer.email) return 'Importer';
  if (email === seededUsers.Approver.email) return 'Approver';
  return null;
}

/**
 * Mock every browser-side back-end call. Routes registered later win, so the
 * catch-all goes first and the specific auth routes override it.
 */
async function mockBrowserApi(page: Page): Promise<void> {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not mocked in e2e' }),
    }),
  );
  await page.route('**/api/auth/sign-in', async (route) => {
    const body = route.request().postDataJSON() as { email?: string } | null;
    const role = roleForEmail(body?.email ?? '');
    if (!role) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify(signInFailureBody()),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'set-cookie': `txn_session=${mockSessionValue(role)}; Path=/; HttpOnly; SameSite=Lax`,
      },
      body: JSON.stringify(userInfoFor(role)),
    });
  });
  await page.route('**/api/auth/me', async (route) => {
    const role = roleFromCookie(await route.request().headerValue('cookie'));
    return route.fulfill({
      status: role ? 200 : 401,
      contentType: 'application/json',
      body: JSON.stringify(
        role ? userInfoFor(role) : unauthenticatedBody('NotSignedIn'),
      ),
    });
  });
}

async function signIn(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel(/^email/i).fill(email);
  await page.getByLabel(/^password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

test.describe('Epic sign-in-and-app-shell, Story 1: Sign in and land on your screen', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.clearCookies();
    await mockBrowserApi(page);
  });

  // AC-5
  test('an Importer lands on Upload and an Approver on Transactions, with name and role in the header', async ({
    page,
    context,
  }) => {
    const cases = [
      { creds: importerUser, role: 'Importer' as const, landing: /\/upload$/ },
      {
        creds: approverUser,
        role: 'Approver' as const,
        landing: /\/transactions$/,
      },
    ];

    for (const { creds, role, landing } of cases) {
      await context.clearCookies();
      await signIn(page, creds.email, creds.password);

      await expect(page).toHaveURL(landing);
      const header = page.getByRole('banner');
      await expect(
        header.getByText(seededUsers[role].name, { exact: true }),
      ).toBeVisible();
      await expect(header.getByText(role, { exact: true })).toBeVisible();
    }
  });

  // AC-6
  test('while signed out, every protected address including the root is redirected server-side to sign-in', async ({
    page,
  }) => {
    for (const address of ['/', '/upload', '/transactions']) {
      const response = await page.goto(address);

      // A server redirect (not a client-side bounce) proves no protected content rendered first.
      expect(response?.request().redirectedFrom()).not.toBeNull();
      await expect(page).toHaveURL(/\/sign-in(\?.*)?$/);
      await expect(
        page.getByRole('heading', { name: /sign in/i }),
      ).toBeVisible();
      await expect(
        page.getByText(seededUsers.Importer.name, { exact: true }),
      ).toHaveCount(0);
    }
  });

  // Accessibility — real-browser axe scan (WCAG 2.1 AA, NFR-base-1) of each state this
  // story introduces: the sign-in screen, its required-field errors, the invalid-
  // credentials error, and the signed-in shell.
  test('sign-in states and the signed-in shell have no accessibility violations', async ({
    page,
  }) => {
    const scan = async () => {
      const { violations } = await new AxeBuilder({ page })
        .withTags(WCAG_21_AA)
        .analyze();
      expect(violations).toEqual([]);
    };

    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await scan();

    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/required/i).first()).toBeVisible();
    await scan();

    await page.getByLabel(/^email/i).fill('nobody@example.com');
    await page.getByLabel(/^password/i).fill(importerUser.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(
      page.getByText(signInFailureBody().message, { exact: true }),
    ).toBeVisible();
    await scan();

    await signIn(page, importerUser.email, importerUser.password);
    await expect(page).toHaveURL(/\/upload$/);
    await expect(page.getByRole('banner')).toBeVisible();
    await scan();
  });
});
