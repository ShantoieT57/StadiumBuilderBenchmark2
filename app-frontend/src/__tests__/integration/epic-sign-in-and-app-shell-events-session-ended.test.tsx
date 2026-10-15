/**
 * The tab's live connection when the session ends (Story 4, BR4 / BR7).
 *
 * When the session ends while the stream is down, the reconnect reaches the
 * same-origin proxy, which answers with a single `session-ended` event (see the
 * proxy tests). The connection must then leave for sign-in with that reason,
 * close for good and never reconnect.
 *
 * jsdom has no EventSource, so the browser API is replaced by an in-test fake;
 * the full-page navigation is observed at `redirectToSignIn`, since jsdom
 * cannot leave the page.
 */
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventsProvider } from '@/contexts/EventsContext';
import { redirectToSignIn } from '@/lib/auth/signIn';

vi.mock('@/lib/auth/signIn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/signIn')>()),
  redirectToSignIn: vi.fn(() => true),
}));

class FakeEventSource extends EventTarget {
  static connections: FakeEventSource[] = [];

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readonly url: string;
  readyState = 0;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeEventSource.connections.push(this);
  }

  close(): void {
    this.readyState = this.CLOSED;
  }

  /** The stream failed and the browser gave up on it. */
  simulateDrop(): void {
    this.readyState = this.CLOSED;
    const event = new Event('error');
    this.dispatchEvent(event);
    this.onerror?.(event);
  }

  /** A named server event (`event: <name>` + `data: <json>`). */
  emit(name: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) }));
  }
}

function openConnections(): FakeEventSource[] {
  return FakeEventSource.connections.filter(
    (connection) => connection.readyState !== connection.CLOSED,
  );
}

describe('Live connection when the session ends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.connections = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('leaves for sign-in with the reason when a reconnect is told the session ended, and stops reconnecting', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(
      <EventsProvider>
        <p>Signed-in screen</p>
      </EventsProvider>,
    );
    await waitFor(() => expect(openConnections()).toHaveLength(1));

    // The stream drops; the session expires while it is down.
    act(() => openConnections()[0].simulateDrop());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    const [reconnect] = openConnections();

    // The reconnect is answered with the proxy's session-ended event.
    act(() =>
      reconnect.emit('session-ended', {
        reason: 'SessionExpired',
        message: 'Your session expired after 60 minutes.',
      }),
    );

    expect(redirectToSignIn).toHaveBeenCalledWith('SessionExpired');
    expect(openConnections()).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(openConnections()).toHaveLength(0);
  });
});
