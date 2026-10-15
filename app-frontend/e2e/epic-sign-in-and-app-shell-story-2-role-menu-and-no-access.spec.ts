/**
 * Story Metadata:
 * - Route: /dashboard
 * - Target File: app-frontend/src/app/(authenticated)/layout.tsx
 *   (navigation component in components/, access map in lib/auth/, (authenticated)/dashboard/page.tsx placeholder)
 * - Page Action: modify_existing
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked. This spec never contacts a live backend and uses no
 *   real credentials.
 * - Sign-in is faked with a mock session cookie: `txn_session=mock-session-<Role>`
 *   (e.g. `mock-session-Approver`), seeded with `context.addCookies()`. Signing in through
 *   the form is Story 1's concern, not this story's.
 * - Two mock layers:
 *   - Node side (the server-side layout gate and role check). The signed-in layout calls
 *     `GET /api/auth/me` from the Next.js server, forwarding the incoming `txn_session`
 *     cookie. `page.route()` cannot see that request. It needs the shared Node-side mock
 *     backend that the e2e run points the server-only `BACKEND_URL` at. That mock answers
 *     `GET /api/auth/me` with `userInfoFor(<Role>)` when the cookie is
 *     `mock-session-<Role>`, and with 401 `unauthenticatedBody('NotSignedIn')` otherwise.
 *   - Browser side, via `page.route()`. Same-origin `/api/auth/me` returns
 *     `userInfoFor(role)`. `/api/events` returns an idle SSE stream. Any other `/api/*` call
 *     gets a 404, so nothing falls through to a real server.
 * - Implementation pattern this assumes:
 *   - The role check runs server-side, before render, from one route-to-role access map
 *     (`src/lib/auth/access.ts`). An Approver on `/upload` stays on `/upload` and sees the
 *     no-access message inside the shell. There is no redirect, no error page and no
 *     Upload content.
 *   - The menu is a `<nav>` of links named "Dashboard", "Transactions" and "Upload".
 *   - Below 768px the inline links are hidden. A button whose accessible name contains
 *     "menu" opens a shadcn Sheet (role `dialog`) that holds the same links. Escape closes it.
 *   - Every focusable control in the shell shows a visible focus indicator under
 *     `:focus-visible`, either a non-zero outline or a box-shadow ring.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * E2E spec for Epic sign-in-and-app-shell, Story 2: Role-based menu and no-access screen.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
// Shared project-wide identity source, imported by relative path (not @/) so Playwright
// can resolve it without alias plumbing.
import { userInfoFor } from '../src/mocks/data/identity';

import type { BrowserContext, Page } from '@playwright/test';
import type { UserRole } from '../src/types/api-generated';

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Seed the mock session cookie the Node-side mock backend maps to `role`. */
async function seedSession(
  context: BrowserContext,
  role: UserRole,
  baseURL: string,
): Promise<void> {
  await context.addCookies([
    {
      name: 'txn_session',
      value: `mock-session-${role}`,
      url: baseURL,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

/** Mock every browser-side same-origin API call for a signed-in `role`. */
async function mockBrowserApi(page: Page, role: UserRole): Promise<void> {
  // Registered first, so it has the lowest precedence: catch-all for anything unexpected.
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not mocked in this spec.' }),
    }),
  );
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(userInfoFor(role)),
    }),
  );
  // An idle SSE stream with a long retry, so EventSource does not hammer reconnects.
  await page.route('**/api/events', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'retry: 600000\n: connected\n\n',
    }),
  );
}

async function signInAs(
  page: Page,
  context: BrowserContext,
  role: UserRole,
  baseURL: string,
): Promise<void> {
  await seedSession(context, role, baseURL);
  await mockBrowserApi(page, role);
}

interface FocusedControl {
  description: string;
  hasVisibleFocus: boolean;
}

/** Describe the currently focused element and whether it shows a visible focus indicator. */
async function describeFocus(page: Page): Promise<FocusedControl | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body || !(el instanceof HTMLElement))
      return null;
    const style = window.getComputedStyle(el);
    const hasOutline =
      style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    const hasRing = style.boxShadow !== 'none' && style.boxShadow !== '';
    const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim();
    return {
      description: `${el.tagName.toLowerCase()}:${name}`,
      hasVisibleFocus: hasOutline || hasRing,
    };
  });
}

/** Press Tab until the focused element matches `target`. Returns whether it was reached. */
async function tabUntil(
  page: Page,
  target: string,
  maxPresses = 40,
): Promise<boolean> {
  for (let i = 0; i < maxPresses; i += 1) {
    await page.keyboard.press('Tab');
    const focused = await describeFocus(page);
    if (focused?.description === target) return true;
  }
  return false;
}

test.describe('Epic sign-in-and-app-shell, Story 2: Role-based menu and no-access screen', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-2
  test('an Approver opening the Upload address sees the no-access message inside the shell', async ({
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

    await page.goto('/upload');

    // It stays on the saved link. This is not a redirect to sign-in or anywhere else.
    await expect(page).toHaveURL(/\/upload$/);

    // The message is shown inside the app shell: the signed-in person and the menu are present.
    const main = page.getByRole('main');
    await expect(
      main.getByText(/you don.t have access to this screen/i),
    ).toBeVisible();
    await expect(main.getByText(/ask your administrator/i)).toBeVisible();
    await expect(page.getByRole('navigation')).toBeVisible();
    await expect(page.getByText(userInfoFor('Approver').name)).toBeVisible();

    // No error page, and no Upload content (the menu has no Upload item, and main has no Upload heading).
    await expect(
      page.getByText(
        /this page could not be found|application error|internal server error/i,
      ),
    ).toHaveCount(0);
    await expect(main.getByRole('heading', { name: /upload/i })).toHaveCount(0);
    await expect(
      page.getByRole('navigation').getByRole('link', { name: 'Upload' }),
    ).toHaveCount(0);

    // Accessibility: scan the no-access state.
    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_21_AA)
      .analyze();
    expect(violations).toEqual([]);
  });

  // AC-3
  test('on a narrow screen the menu collapses behind a labelled menu button that opens, closes and navigates', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signInAs(
      page,
      context,
      'Importer',
      baseURL ?? 'http://localhost:3000',
    );

    await page.goto('/dashboard');

    const menuButton = page.getByRole('button', { name: /menu/i });
    await expect(menuButton).toBeVisible();
    // The inline menu links are folded away at this width.
    await expect(page.getByRole('link', { name: 'Transactions' })).toBeHidden();

    // Open: the Importer's three items are listed.
    await menuButton.click();
    const menu = page.getByRole('dialog');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(
      menu.getByRole('link', { name: 'Transactions' }),
    ).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Upload' })).toBeVisible();

    // Accessibility: scan the open narrow-screen menu.
    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_21_AA)
      .analyze();
    expect(violations).toEqual([]);

    // Close.
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    // Reopen and follow an item.
    await menuButton.click();
    await expect(menu).toBeVisible();
    await menu.getByRole('link', { name: 'Transactions' }).click();
    await expect(page).toHaveURL(/\/transactions$/);
  });

  // AC-5
  test('every shell control is reachable by keyboard with a visible focus indicator, and menu items open with Enter', async ({
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
    await expect(
      page.getByRole('navigation').getByRole('link', { name: 'Upload' }),
    ).toBeVisible();

    // Accessibility: scan the signed-in shell at desktop width.
    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_21_AA)
      .analyze();
    expect(violations).toEqual([]);

    // Tab through the whole page once, recording every focused control.
    const visited: FocusedControl[] = [];
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      const focused = await describeFocus(page);
      if (focused === null) break;
      if (visited.some((v) => v.description === focused.description)) break;
      visited.push(focused);
    }

    const visitedNames = visited.map((v) => v.description);
    expect(visitedNames).toEqual(
      expect.arrayContaining(['a:Dashboard', 'a:Transactions', 'a:Upload']),
    );
    // Every control that was reached shows a visible focus indicator.
    expect(visited.filter((v) => !v.hasVisibleFocus)).toEqual([]);

    // Keyboard alone: Tab to Upload and press Enter to follow it.
    await page.goto('/dashboard');
    await expect(
      page.getByRole('navigation').getByRole('link', { name: 'Upload' }),
    ).toBeVisible();
    expect(await tabUntil(page, 'a:Upload')).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/upload$/);
  });
});
