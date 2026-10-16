/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: app-frontend/src/app/(authenticated)/layout.tsx
 *   (new provider `@/contexts/ImportedCountContext` - `ImportedCountProvider` /
 *    `useImportedCount()`; new badge `@/components/shell/ImportedCountBadge`)
 * - Page Action: modify_existing
 *
 * Tests for Epic approve-and-reject, Story 3: waiting count on the Transactions
 * menu item. Vitest covers AC-1 and AC-4 (AC-2, AC-3 are Playwright).
 *
 * Render scope: the real signed-in layout. Its default export is an async server
 * component, so each test awaits it (with the server-only `requireSession`
 * mocked to the signed-in role) and renders the returned shell inside the
 * ToastProvider the root layout mounts. Contracts these tests pin:
 * - For an Approver only, the layout mounts `ImportedCountProvider` (inside
 *   `EventsProvider`) and passes `badges={{ '/transactions': <ImportedCountBadge /> }}`
 *   to `AppNav`. An Importer gets no provider, no badge and no count request.
 * - The provider loads `getImportedTransactionCount()` (-> `get('/transactions/imported-count')`)
 *   on mount and again on `transactions-changed` / `resync` (via `useEvents().subscribe`).
 * - The badge shows the count up to 99, "99+" above, nothing at 0 or before the
 *   first successful load. Its accessible text is "<N> waiting for review" (a
 *   visually hidden suffix), so the menu link reads e.g.
 *   "Transactions 15 waiting for review".
 * - A failed load keeps the last known count (or no badge) and shows no problem
 *   message; the menu stays usable.
 *
 * jsdom has no EventSource, so an in-test fake is used under the real
 * EventsProvider. Only `@/lib/api/client`, `next/navigation` and the server-only
 * `requireSession` are mocked; the count body comes from the shared factory.
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignedInLayout from '@/app/(authenticated)/layout';
import { ToastProvider } from '@/contexts/ToastContext';
import { get } from '@/lib/api/client';
// Project-wide mock data shared with the Playwright layer (never re-defined here).
import { userInfoFor } from '@/mocks/data/identity';
import {
  SEEDED_IMPORTED_COUNT,
  createImportedTransactionCount,
} from '@/mocks/data/importedCount';
import type {
  CurrentUser,
  ImportedTransactionCount,
  UserRole,
} from '@/types/api-generated';

const session = vi.hoisted(() => ({ user: undefined as unknown }));

vi.mock('@/lib/auth/requireSession', () => ({
  requireSession: vi.fn(async () => session.user),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => '/transactions',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  get: vi.fn(),
  post: vi.fn(),
}));

const mockGet = get as ReturnType<typeof vi.fn>;

const COUNT_PATH = '/transactions/imported-count';

/** Stand-in for the browser EventSource (absent from jsdom). */
class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static connections: FakeEventSource[] = [];

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readonly url: string;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeEventSource.connections.push(this);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  /** A named server event (`event: <name>` + `data: <json>`). */
  emit(name: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) }));
  }
}

/** In-test back-end: what GET /transactions/imported-count answers right now. */
let countBody: ImportedTransactionCount = createImportedTransactionCount();
/** Every path the mocked API client was asked for, in order. */
let requested: string[] = [];

function serveApi(): void {
  mockGet.mockImplementation(async (endpoint: unknown) => {
    const path = String(endpoint);
    requested.push(path);
    if (path === COUNT_PATH) return countBody;
    throw { message: `Unexpected call ${path}`, statusCode: 404 };
  });
}

/** Renders the real signed-in shell for `role` around some screen content. */
async function renderShell(role: UserRole) {
  session.user = userInfoFor(role) as CurrentUser;
  const shell = await SignedInLayout({ children: <p>Screen content</p> });
  return render(<ToastProvider>{shell}</ToastProvider>);
}

function mainNav(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Main' });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The Transactions link's accessible name carrying a waiting-count badge. */
function withBadge(shown: string): RegExp {
  return new RegExp(
    `^Transactions\\W*${escapeRegExp(shown)}\\s*waiting for review$`,
    'i',
  );
}

interface HeldAnswer {
  started: boolean;
  resolve: (body: ImportedTransactionCount) => void;
  reject: (error: unknown) => void;
}

/** Holds the next API answer open until the test settles it. */
function holdNextAnswer(): HeldAnswer {
  const held: HeldAnswer = {
    started: false,
    resolve: () => undefined,
    reject: () => undefined,
  };
  mockGet.mockImplementationOnce((endpoint: unknown) => {
    requested.push(String(endpoint));
    held.started = true;
    return new Promise<ImportedTransactionCount>((resolve, reject) => {
      held.resolve = resolve;
      held.reject = reject;
    });
  });
  return held;
}

/** Waits for the held count request, then answers it. */
async function answer(
  held: HeldAnswer,
  outcome: { body: ImportedTransactionCount } | { error: unknown },
): Promise<void> {
  await waitFor(() => {
    expect(held.started).toBe(true);
  });
  await act(async () => {
    if ('body' in outcome) held.resolve(outcome.body);
    else held.reject(outcome.error);
  });
}

const SERVER_ERROR = { message: 'Something went wrong', statusCode: 500 };

describe('Epic approve-and-reject, Story 3: waiting count on the menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.connections = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    countBody = createImportedTransactionCount();
    requested = [];
    serveApi();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // AC-1
  it('shows Approvers the Imported count up to 99, "99+" above, no badge at zero, and never shows Importers a badge', async () => {
    const user = userEvent.setup();

    // Seeded: 15 waiting, in the wide-screen menu and the phone menu.
    const seeded = await renderShell('Approver');
    const link = await within(mainNav()).findByRole('link', {
      name: withBadge(String(SEEDED_IMPORTED_COUNT)),
    });
    expect(link).toHaveAttribute('href', '/transactions');
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    const phoneMenu = await screen.findByRole('dialog');
    expect(
      within(phoneMenu).getByRole('link', {
        name: withBadge(String(SEEDED_IMPORTED_COUNT)),
      }),
    ).toBeInTheDocument();
    seeded.unmount();

    // Exactly 99 is shown as the number.
    countBody = createImportedTransactionCount({ count: 99 });
    const ninetyNine = await renderShell('Approver');
    const exact = await within(mainNav()).findByRole('link', {
      name: withBadge('99'),
    });
    expect(exact).not.toHaveTextContent('99+');
    ninetyNine.unmount();

    // Above 99 reads "99+", never the raw number.
    countBody = createImportedTransactionCount({ count: 120 });
    const many = await renderShell('Approver');
    const capped = await within(mainNav()).findByRole('link', {
      name: withBadge('99+'),
    });
    expect(capped).not.toHaveTextContent('120');
    many.unmount();

    // Zero: no badge at all.
    const zero = holdNextAnswer();
    const none = await renderShell('Approver');
    await answer(zero, { body: createImportedTransactionCount({ count: 0 }) });
    expect(
      within(mainNav()).getByRole('link', { name: 'Transactions' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/waiting for review/i)).not.toBeInTheDocument();
    none.unmount();

    // Importer: never a badge, and the count is never requested - even though
    // this in-test back-end would answer it.
    countBody = createImportedTransactionCount();
    requested = [];
    await renderShell('Importer');
    expect(
      within(mainNav()).getByRole('link', { name: 'Transactions' }),
    ).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText(/waiting for review/i)).not.toBeInTheDocument();
    expect(requested).not.toContain(COUNT_PATH);
  });

  // AC-4
  it('keeps the last known count (or no badge) when the count cannot be loaded, without blocking the menu, and picks up the right number on the next update', async () => {
    // First load fails: no badge, no problem message, menu fully usable.
    const firstLoad = holdNextAnswer();
    await renderShell('Approver');
    await answer(firstLoad, { error: SERVER_ERROR });

    const nav = within(mainNav());
    expect(nav.getByRole('link', { name: 'Transactions' })).toHaveAttribute(
      'href',
      '/transactions',
    );
    expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(screen.queryByText(/waiting for review/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Screen content')).toBeInTheDocument();

    const [connection] = FakeEventSource.connections;
    expect(connection).toBeDefined();

    // The next update loads the current number.
    act(() =>
      connection.emit('transactions-changed', {
        fileId: '7c1e2a40-0000-4000-8000-000000000001',
      }),
    );
    expect(
      await nav.findByRole('link', {
        name: withBadge(String(SEEDED_IMPORTED_COUNT)),
      }),
    ).toBeInTheDocument();

    // A later load fails: the last known count stays, still no problem message.
    const failedRefresh = holdNextAnswer();
    act(() => connection.emit('resync', {}));
    await answer(failedRefresh, { error: SERVER_ERROR });
    expect(
      nav.getByRole('link', {
        name: withBadge(String(SEEDED_IMPORTED_COUNT)),
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // And the update after that picks up the right number again.
    countBody = createImportedTransactionCount({ count: 13 });
    act(() => connection.emit('resync', {}));
    expect(
      await nav.findByRole('link', { name: withBadge('13') }),
    ).toBeInTheDocument();
  });
});
