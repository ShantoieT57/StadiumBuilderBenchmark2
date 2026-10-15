/**
 * Story Metadata:
 * - Route: null (not routable — app-wide shared mechanism)
 * - Target File: app-frontend/src/contexts/ToastContext.tsx
 *   (with src/components/toast/Toast.tsx and src/components/toast/ToastContainer.tsx)
 * - Page Action: modify_existing
 *
 * Tests for Epic sign-in-and-app-shell, Story 3: Shared success and problem messages
 * (R16, BR10, NFR-5).
 *
 * The real ToastProvider + ToastContainer are rendered; a minimal consumer raises a
 * message through the real `useToast()` hook, exactly as feature code will.
 *
 * Timer note: the auto-dismiss timer is component-local with no route/flow of its own,
 * so AC-1/AC-2 use `vi.useFakeTimers()` (the testing-policy last resort for exactly
 * this case). No axe() runs under fake timers.
 *
 * Assumption for AC-4: the dismiss button's visible label on hover/focus is a Shadcn
 * Tooltip (role="tooltip") composed per Rule 1.
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastContainer } from '@/components/toast/ToastContainer';
import { ToastProvider, useToast } from '@/contexts/ToastContext';
import type { ToastVariant } from '@/types/toast';

/** Raises one message on mount through the real shared hook. */
function RaiseMessage({
  variant,
  title,
}: {
  variant: ToastVariant;
  title: string;
}) {
  const { showToast } = useToast();
  useEffect(() => {
    showToast({ variant, title });
  }, [showToast, variant, title]);
  return null;
}

function renderWithMessages(
  messages: Array<{ variant: ToastVariant; title: string }>,
) {
  return render(
    <ToastProvider>
      {messages.map((m) => (
        <RaiseMessage key={m.title} variant={m.variant} title={m.title} />
      ))}
      <ToastContainer />
    </ToastProvider>,
  );
}

describe('Shared success and problem messages', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // AC-1
  it('a success message disappears on its own after a few seconds', () => {
    vi.useFakeTimers();
    renderWithMessages([{ variant: 'success', title: 'Changes saved' }]);

    expect(screen.getByText('Changes saved')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(screen.queryByText('Changes saved')).not.toBeInTheDocument();
  });

  // AC-2
  it('a problem message never disappears on a timer and stays until dismissed', () => {
    vi.useFakeTimers();
    renderWithMessages([{ variant: 'error', title: 'Cannot reach the app' }]);

    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });

    const problem = screen.getByRole('alert');
    expect(
      within(problem).getByText('Cannot reach the app'),
    ).toBeInTheDocument();

    act(() => {
      within(problem)
        .getByRole('button', { name: /dismiss/i })
        .click();
    });

    expect(screen.queryByText('Cannot reach the app')).not.toBeInTheDocument();
  });

  // AC-3
  it('states each message kind in words and announces it (polite for success, assertive for problems)', () => {
    renderWithMessages([
      { variant: 'success', title: 'Changes saved' },
      { variant: 'error', title: 'Cannot reach the app' },
    ]);

    const success = screen.getByRole('status');
    expect(within(success).getByText('Success')).toBeInTheDocument();
    expect(within(success).getByText('Changes saved')).toBeInTheDocument();

    const problem = screen.getByRole('alert');
    expect(within(problem).getByText('Problem')).toBeInTheDocument();
    expect(
      within(problem).getByText('Cannot reach the app'),
    ).toBeInTheDocument();
  });

  // AC-4
  it('can be dismissed with the keyboard alone, showing a visible dismiss label on focus', async () => {
    const user = userEvent.setup();
    renderWithMessages([{ variant: 'error', title: 'Cannot reach the app' }]);

    const problem = screen.getByRole('alert');
    const dismiss = within(problem).getByRole('button', { name: /dismiss/i });

    await user.tab();
    expect(dismiss).toHaveFocus();
    expect(
      await screen.findByRole('tooltip', { name: /dismiss/i }),
    ).toBeInTheDocument();

    await user.keyboard('{Enter}');

    expect(screen.queryByText('Cannot reach the app')).not.toBeInTheDocument();
  });
});
