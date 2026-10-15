/**
 * Story Metadata:
 * - Route: /transactions/[transactionId]
 * - Target File: app-frontend/src/app/(authenticated)/transactions/[transactionId]/page.tsx
 * - Page Action: create_new
 *
 * Tests for Epic transactions-list, Story 3: transaction details.
 *
 * Render scope: through the page modules. The signed-in pages are server components
 * whose `RouteGuard` (async, server-only session check) jsdom cannot render, so each
 * test calls the page's default export, checks it wraps its content in
 * `<RouteGuard route="/transactions">`, and renders that content inside the same
 * providers the real layouts mount (ToastProvider + EventsProvider). Implementation
 * contract these tests assume:
 * - The details page default export takes Next's `{ params: Promise<{ transactionId }> }`
 *   (sync or async), and returns `<RouteGuard route="/transactions">` as its OUTERMOST
 *   element, whose children are the client content (suggested:
 *   `TransactionDetailsView` in `@/components/transactions/TransactionDetailsView`,
 *   props `{ transactionId: string }`).
 * - The content loads the transaction with `getTransaction(id)` from
 *   `@/lib/api/endpoints` (-> `get('/transactions/<id>')` on the API client).
 * - Fields render as a description list: each label in a `<dt>` immediately followed
 *   by its value in a `<dd>`. Labels used here: "Status", "Last changed by",
 *   "Rejection reason". The status value is the status in words.
 * - The rejection reason is plain read-only text (no textbox), and no "Rejection
 *   reason" label renders at all when the status is not Rejected.
 * - States: while loading, visible text containing "Loading"; a failed load shows a
 *   `role="alert"` problem plus a "Retry" button that reloads in place; a 404 shows
 *   "Transaction not found".
 * - AC-6 (list part) is asserted through the list page module
 *   `@/app/(authenticated)/transactions/page` (being built by Story 1 in parallel),
 *   ASSUMING only that it also returns `<RouteGuard route="/transactions">` as its
 *   outermost element and that its content loads `getTransactions` and shows each
 *   row's reference. No list-component name or prop contract is assumed.
 * - Neither page renders a button or link named Approve, Reject or Export, whichever
 *   role is signed in (the signed-in user is served from GET /auth/me in case the
 *   content asks for it).
 *
 * Data-contract: the API client is mocked; the real proxy -> back-end chain is
 * verified during the manual checklist and the Playwright spec.
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Will fail until implemented (TDD red)
import TransactionDetailsPage from '@/app/(authenticated)/transactions/[transactionId]/page';
import TransactionsPage from '@/app/(authenticated)/transactions/page';
import { RouteGuard } from '@/components/shell/RouteGuard';
import { EventsProvider } from '@/contexts/EventsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { get } from '@/lib/api/client';
// Project-wide mock data shared with the Playwright layer (never re-defined here).
import { filePageOf, seedFiles } from '@/mocks/data/files';
import { userInfoFor } from '@/mocks/data/identity';
import {
  createTransactionDetails,
  pageOf,
  seedTransactions,
} from '@/mocks/data/transactions';
import type { TransactionDetails, UserRole } from '@/types/api-generated';

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  get: vi.fn(),
  post: vi.fn(),
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
}));

const mockGet = get as ReturnType<typeof vi.fn>;

/** Minimal stand-in for the browser EventSource (absent from jsdom). */
class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
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
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }
}

/** Next page props, loose enough for either page's signature. */
type PageModule = (props: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string>>;
}) => ReactNode | Promise<ReactNode>;

/**
 * Calls a page's default export, checks it is guarded by
 * `<RouteGuard route="/transactions">`, and renders the guarded content inside the
 * providers the real root and signed-in layouts mount.
 */
async function renderGuardedPage(
  page: unknown,
  params: Record<string, string> = {},
): Promise<{ unmount: () => void }> {
  const element = await (page as PageModule)({
    params: Promise.resolve(params),
    searchParams: Promise.resolve({}),
  });
  if (!isValidElement(element)) {
    throw new Error('The page did not return a React element');
  }
  const guarded = element as ReactElement<{
    route: string;
    children: ReactNode;
  }>;
  expect(guarded.type).toBe(RouteGuard);
  expect(guarded.props.route).toBe('/transactions');
  return render(
    <ToastProvider>
      <EventsProvider>{guarded.props.children}</EventsProvider>
    </ToastProvider>,
  );
}

function renderDetailsPage(transactionId: string) {
  return renderGuardedPage(TransactionDetailsPage, { transactionId });
}

/** The `<dd>` value that follows the `<dt>` label matching `label`. */
async function findFieldValue(label: RegExp): Promise<HTMLElement> {
  const term = await screen.findByText(label, { selector: 'dt' });
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement) || value.tagName !== 'DD') {
    throw new Error(`No <dd> value follows the "${String(label)}" label`);
  }
  return value;
}

/**
 * Serves the mocked API: the given details record for its own id, a page of the
 * seeded list, the seeded files, and the signed-in user for `role`.
 */
function serveApi(details: TransactionDetails, role: UserRole = 'Approver') {
  mockGet.mockImplementation((url: unknown) => {
    if (url === `/transactions/${encodeURIComponent(details.id)}`) {
      return Promise.resolve(details);
    }
    if (url === '/transactions') {
      return Promise.resolve(pageOf(seedTransactions()));
    }
    if (url === '/files') {
      return Promise.resolve(filePageOf(seedFiles()));
    }
    if (url === '/auth/me') {
      return Promise.resolve(userInfoFor(role));
    }
    return Promise.reject({ message: 'Not found', statusCode: 404 });
  });
}

describe('Epic transactions-list, Story 3: transaction details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // AC-2
  it('shows a rejected transaction’s reason as read-only text, and no reason for one that is not rejected', async () => {
    const rejected = createTransactionDetails({
      id: '5d0c9b10-0000-4000-8000-000000000004',
      reference: 'TXN-20260404-0004',
      status: 'Rejected',
      rejectionReason: 'Duplicate of an earlier payment',
    });
    serveApi(rejected);
    const { unmount } = await renderDetailsPage(rejected.id);

    const reason = await findFieldValue(/^rejection reason$/i);
    expect(reason).toHaveTextContent('Duplicate of an earlier payment');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    unmount();

    const approved = createTransactionDetails({
      id: '5d0c9b10-0000-4000-8000-000000000002',
      reference: 'TXN-20260402-0002',
      status: 'Approved',
    });
    serveApi(approved);
    await renderDetailsPage(approved.id);

    expect(await findFieldValue(/^status$/i)).toHaveTextContent('Approved');
    expect(screen.queryByText(/rejection reason/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText('Duplicate of an earlier payment'),
    ).not.toBeInTheDocument();
  });

  // AC-3
  it('shows a freshly loaded transaction with status Imported and last changed by System', async () => {
    const fresh = createTransactionDetails({ status: 'Imported' });
    serveApi(fresh);
    await renderDetailsPage(fresh.id);

    expect(await findFieldValue(/^status$/i)).toHaveTextContent(/^Imported$/);
    expect(await findFieldValue(/^last changed by$/i)).toHaveTextContent(
      /^System$/,
    );
  });

  // AC-5
  it('shows loading, then a problem with Retry that reloads, and a not-found message for an unknown transaction', async () => {
    const user = userEvent.setup();
    const details = createTransactionDetails({ status: 'Imported' });

    // Loading: the request has not answered yet.
    mockGet.mockImplementation(() => new Promise(() => {}));
    const loading = await renderDetailsPage(details.id);
    expect(await screen.findByText(/loading/i)).toBeInTheDocument();
    loading.unmount();

    // Problem with Retry: the first load fails, the retry succeeds in place.
    let failNextLoad = true;
    mockGet.mockImplementation((url: unknown) => {
      if (failNextLoad) {
        return Promise.reject({
          message: 'Internal server error',
          statusCode: 500,
        });
      }
      if (url === `/transactions/${encodeURIComponent(details.id)}`) {
        return Promise.resolve(details);
      }
      return Promise.reject({ message: 'Not found', statusCode: 404 });
    });
    const failing = await renderDetailsPage(details.id);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    failNextLoad = false;
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(await findFieldValue(/^status$/i)).toHaveTextContent('Imported');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    failing.unmount();

    // Not found: the back-end answers 404 for an unknown id.
    mockGet.mockImplementation(() =>
      Promise.reject({ message: 'Transaction not found', statusCode: 404 }),
    );
    await renderDetailsPage('5d0c9b10-0000-4000-8000-0000000000ff');
    expect(
      await screen.findByText(/transaction not found/i),
    ).toBeInTheDocument();
  });

  // AC-6
  it('shows no Approve, Reject or Export controls on the list or the details to an Importer or an Approver', async () => {
    const details = createTransactionDetails({ status: 'Imported' });
    const firstListReference = seedTransactions()[0].reference;
    const forbiddenControl = /\b(approve|reject|export)\b/i;

    for (const role of ['Importer', 'Approver'] as const) {
      serveApi(details, role);

      // The list (asserted through the list page; see the header assumption).
      const list = await renderGuardedPage(TransactionsPage);
      await screen.findAllByText(firstListReference);
      expect(
        screen.queryByRole('button', { name: forbiddenControl }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: forbiddenControl }),
      ).not.toBeInTheDocument();
      list.unmount();

      // The details.
      const detailsView = await renderDetailsPage(details.id);
      await findFieldValue(/^status$/i);
      expect(
        screen.queryByRole('button', { name: forbiddenControl }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: forbiddenControl }),
      ).not.toBeInTheDocument();
      detailsView.unmount();
    }
  });
});
