/**
 * Story Metadata:
 * - Route: /dashboard
 * - Target File: app-frontend/src/app/(authenticated)/layout.tsx
 *   (navigation component at app-frontend/src/components/shell/AppNav.tsx,
 *    route-to-role access map at app-frontend/src/lib/auth/access.ts)
 * - Page Action: modify_existing
 *
 * Tests for Epic sign-in-and-app-shell, Story 2: role-based menu and icon-button tooltips.
 *
 * Render scope: the navigation component directly (the signed-in layout is an async
 * server component that jsdom cannot render). Implementation contract these tests assume:
 * - `AppNav` is a client component exported from `@/components/shell/AppNav`, taking
 *   `{ role: UserRole }` and rendering the menu from the shared access map in
 *   `@/lib/auth/access` (the same map the server-side route guard reads).
 * - The menu links sit inside a single `<nav>` landmark; items a role may not use are
 *   not rendered at all (not disabled).
 * - The narrow-screen menu toggle is an icon-only button whose accessible name contains
 *   "menu"; it carries a shadcn Tooltip (with its own TooltipProvider) showing that label
 *   on hover and on keyboard focus. Radix Tooltip needs `ResizeObserver`; if jsdom lacks
 *   it, add a guarded no-op polyfill to `vitest.setup.ts`.
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
// Will fail until implemented (TDD red)
import { AppNav } from '@/components/shell/AppNav';
// Project-wide identity source shared with the Playwright layer.
import { userInfoFor } from '@/mocks/data/identity';

describe('Epic sign-in-and-app-shell, Story 2: role-based menu', () => {
  // AC-1
  it('shows Importers Dashboard, Transactions and Upload, and Approvers no Upload item at all', () => {
    const importer = userInfoFor('Importer');
    const { unmount } = render(<AppNav role={importer.role} />);

    const importerNav = screen.getByRole('navigation');
    const importerLinks = within(importerNav).getAllByRole('link');
    expect(importerLinks.map((link) => link.textContent?.trim())).toEqual([
      'Dashboard',
      'Transactions',
      'Upload',
    ]);
    expect(
      within(importerNav).getByRole('link', { name: 'Dashboard' }),
    ).toHaveAttribute('href', '/dashboard');
    expect(
      within(importerNav).getByRole('link', { name: 'Transactions' }),
    ).toHaveAttribute('href', '/transactions');
    expect(
      within(importerNav).getByRole('link', { name: 'Upload' }),
    ).toHaveAttribute('href', '/upload');

    unmount();

    const approver = userInfoFor('Approver');
    render(<AppNav role={approver.role} />);

    const approverNav = screen.getByRole('navigation');
    const approverLinks = within(approverNav).getAllByRole('link');
    expect(approverLinks.map((link) => link.textContent?.trim())).toEqual([
      'Dashboard',
      'Transactions',
    ]);
    // Hidden, not disabled: no Upload link, button or text anywhere in the menu.
    expect(
      screen.queryByRole('link', { name: /upload/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /upload/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/upload/i)).not.toBeInTheDocument();
  });
});

describe('Epic sign-in-and-app-shell, Story 2: icon-only button labels', () => {
  // AC-4
  it('shows the menu button label as a tooltip on pointer hover and on keyboard focus', async () => {
    const user = userEvent.setup();
    render(<AppNav role={userInfoFor('Importer').role} />);

    const menuButton = screen.getByRole('button', { name: /menu/i });
    // Icon-only: no visible text inside the button itself.
    expect(menuButton.textContent?.trim()).toBe('');

    // Pointer rests on the button -> label appears.
    await user.hover(menuButton);
    const hoverTooltip = await screen.findByRole(
      'tooltip',
      {},
      { timeout: 2000 },
    );
    expect(hoverTooltip).toHaveTextContent(/menu/i);

    // Pointer leaves -> label goes away.
    await user.unhover(menuButton);
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    // Keyboard focus reaches the button -> label appears again.
    act(() => {
      menuButton.focus();
    });
    expect(menuButton).toHaveFocus();
    const focusTooltip = await screen.findByRole(
      'tooltip',
      {},
      { timeout: 2000 },
    );
    expect(focusTooltip).toHaveTextContent(/menu/i);
  });
});
