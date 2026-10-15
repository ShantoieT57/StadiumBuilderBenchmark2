/**
 * Story Metadata:
 * - Route: /dashboard
 * - Target File: app-frontend/src/app/(signed-in)/layout.tsx
 *   (sign-out control, events provider in contexts/, app/api/events/route.ts streaming
 *   proxy, 401 handling in lib/api/client.ts, reason messages on app/sign-in/page.tsx)
 * - Page Action: modify_existing
 *
 * Tests for Epic sign-in-and-app-shell, Story 4: Sign out and being signed out.
 * Vitest covers AC-3 and AC-6 only (AC-1, AC-2, AC-4, AC-5 are Playwright).
 *
 * Contracts these tests pin (the developer implements to them):
 * - `@/app/sign-in/page` (default export) is rendered as an element and reads the
 *   redirect reason from `useSearchParams().get('reason')`, i.e. the 401 handler and
 *   the `session-ended` handler send the person to `/sign-in?reason=<UnauthenticatedReason>`.
 *   The reason message may be inline or a persistent problem message (Story 3 toast);
 *   the shared ToastProvider + ToastContainer are mounted around the page so either works.
 * - `@/contexts/EventsContext` exports `EventsProvider` and `useEvents()`, where
 *   `useEvents().subscribe(eventName, handler)` returns an unsubscribe function.
 *   The provider opens the single per-tab connection with the browser `EventSource`
 *   pointed at the same-origin `/api/events` route.
 * - `@/components/shell/SignOutButton` exports `SignOutButton` (no required props),
 *   a "Sign out" button that calls `signOut()` (POST /auth/sign-out via the API client)
 *   and closes the live connection.
 * - A connection that drops to CLOSED (e.g. the proxy answers 502 while the back-end
 *   restarts) is re-opened by the provider within the server's 5-second retry.
 *
 * jsdom has no EventSource, so the browser API is replaced by an in-test fake that
 * records every connection; only `@/lib/api/client` and `next/navigation` are mocked.
 */
import { StrictMode, useEffect, useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Imports below target not-yet-built modules - will fail until implemented (TDD red).
import SignInPage from '@/app/sign-in/page';
import { EventsProvider, useEvents } from '@/contexts/EventsContext';
import { SignOutButton } from '@/components/shell/SignOutButton';
import { ToastProvider } from '@/contexts/ToastContext';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { get, post } from '@/lib/api/client';
import type {
  FileChangedEvent,
  UnauthenticatedReason,
} from '@/types/api-generated';

const navigation = vi.hoisted(() => ({
  search: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: navigation.push,
    replace: navigation.replace,
    refresh: navigation.refresh,
  }),
  usePathname: () => '/dashboard',
  useSearchParams: () => navigation.search,
}));

vi.mock('@/lib/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  apiClient: vi.fn(),
}));

const mockGet = get as ReturnType<typeof vi.fn>;
const mockPost = post as ReturnType<typeof vi.fn>;

/** Stand-in for the browser EventSource (absent from jsdom); records every connection. */
class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static connections: FakeEventSource[] = [];

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readonly url: string;
  readonly withCredentials: boolean;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL, init?: EventSourceInit) {
    super();
    this.url = String(url);
    this.withCredentials = Boolean(init?.withCredentials);
    FakeEventSource.connections.push(this);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  /** The server accepted the stream. */
  simulateOpen(): void {
    this.readyState = FakeEventSource.OPEN;
    const event = new Event('open');
    this.dispatchEvent(event);
    this.onopen?.(event);
  }

  /** The stream failed and the browser gave up on it (e.g. a 502 from the proxy). */
  simulateDrop(): void {
    this.readyState = FakeEventSource.CLOSED;
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
    (connection) => connection.readyState !== FakeEventSource.CLOSED,
  );
}

/** A later-epic style consumer of the subscribe API. */
function LiveStatus({
  eventName,
  label,
}: {
  eventName: 'file-changed' | 'transactions-changed';
  label: string;
}) {
  const { subscribe } = useEvents();
  const [status, setStatus] = useState('waiting');
  useEffect(
    () => subscribe(eventName, () => setStatus('received')),
    [subscribe, eventName],
  );
  return <p>{`${label}: ${status}`}</p>;
}

const fileChanged: FileChangedEvent = {
  fileId: 'file-0001',
  status: 'Completed',
  isCancelled: false,
};

describe('Epic sign-in-and-app-shell, Story 4: Sign out and being signed out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.search = new URLSearchParams();
    FakeEventSource.connections = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    mockGet.mockResolvedValue(undefined);
    mockPost.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // AC-3
  it('shows the idle-timeout or other-device message for those reasons, and nothing special for an ordinary signed-out visit', async () => {
    const renderSignIn = (reason: UnauthenticatedReason | null) => {
      navigation.search = new URLSearchParams(reason ? { reason } : {});
      return render(
        <ToastProvider>
          <SignInPage />
          <ToastContainer />
        </ToastProvider>,
      );
    };

    const expired = renderSignIn('SessionExpired');
    expect(await screen.findByText(/60 minutes/i)).toBeInTheDocument();
    expect(screen.queryByText(/another device/i)).not.toBeInTheDocument();
    expired.unmount();

    const elsewhere = renderSignIn('SignedInElsewhere');
    expect(await screen.findByText(/another device/i)).toBeInTheDocument();
    expect(screen.queryByText(/60 minutes/i)).not.toBeInTheDocument();
    elsewhere.unmount();

    for (const reason of [null, 'NotSignedIn'] as const) {
      const ordinary = renderSignIn(reason);
      expect(
        await screen.findByRole('button', { name: /sign in/i }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/60 minutes/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/another device/i)).not.toBeInTheDocument();
      ordinary.unmount();
    }
  });

  // AC-6
  it('keeps exactly one live connection per tab, reconnects by itself after a drop, and closes it on sign-out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <StrictMode>
        <ToastProvider>
          <EventsProvider>
            <LiveStatus eventName="file-changed" label="File updates" />
            <LiveStatus
              eventName="transactions-changed"
              label="Transaction updates"
            />
            <SignOutButton />
          </EventsProvider>
        </ToastProvider>
      </StrictMode>,
    );

    // One connection for the whole tab, to the same-origin proxy, shared by every subscriber.
    await waitFor(() => expect(openConnections()).toHaveLength(1));
    const [first] = openConnections();
    expect(first.url).toMatch(/\/api\/events$/);
    act(() => {
      first.simulateOpen();
      first.emit('file-changed', fileChanged);
    });
    expect(screen.getByText('File updates: received')).toBeInTheDocument();
    expect(
      screen.getByText('Transaction updates: waiting'),
    ).toBeInTheDocument();

    // The connection drops; within the server's 5-second retry a single new one is open.
    act(() => first.simulateDrop());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(openConnections()).toHaveLength(1);
    const [second] = openConnections();
    expect(second).not.toBe(first);
    act(() => second.simulateOpen());

    // Signing out closes the connection, and it stays closed.
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(openConnections()).toHaveLength(0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(openConnections()).toHaveLength(0);
  });
});
