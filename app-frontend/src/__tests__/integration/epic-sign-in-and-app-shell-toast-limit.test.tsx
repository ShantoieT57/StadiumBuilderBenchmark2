/**
 * Shared messages when more are raised than fit on screen (Story 3, BR10).
 *
 * At most three messages show; the oldest self-closing ones make room. A
 * problem is never pushed off screen, and a message just raised is never
 * dropped (its id was handed back to the caller).
 */
import { render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';

import { ToastContainer } from '@/components/toast/ToastContainer';
import { ToastProvider, useToast } from '@/contexts/ToastContext';
import type { ToastVariant } from '@/types/toast';

type Message = { variant: ToastVariant; title: string };

/** Raises the messages in order, on mount, through the real shared hook. */
function RaiseMessages({ messages }: { messages: Message[] }) {
  const { showToast } = useToast();
  useEffect(() => {
    messages.forEach((message) => showToast(message));
  }, [showToast, messages]);
  return null;
}

function renderWithMessages(messages: Message[]) {
  return render(
    <ToastProvider>
      <RaiseMessages messages={messages} />
      <ToastContainer />
    </ToastProvider>,
  );
}

describe('Shared messages beyond the on-screen limit', () => {
  it('shows a new success message even when three problems are already showing', () => {
    renderWithMessages([
      { variant: 'error', title: 'Problem one' },
      { variant: 'error', title: 'Problem two' },
      { variant: 'error', title: 'Problem three' },
      { variant: 'success', title: 'Changes saved' },
    ]);

    expect(screen.getByText('Changes saved')).toBeInTheDocument();
    expect(screen.getByText('Problem one')).toBeInTheDocument();
    expect(screen.getByText('Problem two')).toBeInTheDocument();
    expect(screen.getByText('Problem three')).toBeInTheDocument();
  });

  it('makes room by closing the oldest self-closing message, never a problem', () => {
    renderWithMessages([
      { variant: 'info', title: 'Older note' },
      { variant: 'error', title: 'Problem one' },
      { variant: 'error', title: 'Problem two' },
      { variant: 'success', title: 'Changes saved' },
    ]);

    expect(screen.queryByText('Older note')).not.toBeInTheDocument();
    expect(screen.getByText('Changes saved')).toBeInTheDocument();
    expect(screen.getByText('Problem one')).toBeInTheDocument();
    expect(screen.getByText('Problem two')).toBeInTheDocument();
  });
});
