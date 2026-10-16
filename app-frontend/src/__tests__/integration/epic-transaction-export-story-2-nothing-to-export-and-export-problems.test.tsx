/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: app-frontend/src/components/transactions/TransactionsList.tsx
 * - Page Action: modify_existing
 *
 * Tests for Epic transaction-export, Story 2: nothing to export, and export
 * problems. Vitest covers AC-1 and AC-3 (AC-2, AC-4 and AC-5 are Playwright).
 *
 * Render scope: the page reads the signed-in role on the server, which jsdom cannot
 * run, so the list is rendered through its client component `TransactionsList` with
 * `role="Approver"`, inside the providers the real layouts mount (ToastProvider +
 * ToastContainer + EventsProvider).
 *
 * Implementation contract these tests assume (story 1 builds the button):
 * - An Approver sees a button named "Export" (shows "Exporting…" while in flight).
 *   Selecting it calls `exportTransactions(query)` from `@/lib/api/endpoints`
 *   (the list's filter + sort query, no `page` / `pageSize`), which resolves to
 *   `{ blob, fileName }` or throws the API client's `APIError` shape. On success a
 *   `success` toast "Export downloaded" naming the file appears in the
 *   "Notifications" region.
 * - Nothing to export (story 2, R6 / BR5): once the loaded list's `totalCount` is 0,
 *   Export has `aria-disabled="true"` (stays focusable), a click sends nothing, and
 *   a visible note beside it, linked by `aria-describedby`, reads
 *   NO_MATCHES_TO_EXPORT_MESSAGE with active filters, else
 *   NO_TRANSACTIONS_TO_EXPORT_MESSAGE. When the filters match again it is available.
 * - Failures (NFR-2): an inline `role="alert"` beside Export (not a toast). Network
 *   / 5xx: "The export could not be downloaded." + a "Try again" button that repeats
 *   the same query; 403: the server's `message` verbatim.
 *
 * Mocking: `@/lib/api/client` is mocked for the list (as the other transactions
 * tests do); the export endpoint function is mocked as well, because story 1 may
 * build it on `fetch` + the client's error helpers inside `lib/api/` rather than
 * on `apiClient` (mock-facts.md allows either). The export body comes from the
 * shared `createTransactionExport()` factory.
 *
 * Data-contract: full chain verified during manual checklist and the Playwright spec.
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionsList } from '@/components/transactions/TransactionsList';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { EventsProvider } from '@/contexts/EventsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { apiClient, get, post } from '@/lib/api/client';
// Will fail until implemented (TDD red): story 1 adds the export endpoint.
import { exportTransactions } from '@/lib/api/endpoints';
// Project-wide mock data shared with the Playwright layer (never re-defined here).
import {
  FORBIDDEN_MESSAGE,
  forbiddenBody,
  userInfoFor,
} from '@/mocks/data/identity';
import { createImportedTransactionCount } from '@/mocks/data/importedCount';
import {
  NO_MATCHES_TO_EXPORT_MESSAGE,
  NO_TRANSACTIONS_TO_EXPORT_MESSAGE,
  createTransactionExport,
} from '@/mocks/data/transactionExport';
import {
  pageOf,
  seedTransactionDetails,
  toListItem,
} from '@/mocks/data/transactions';
import type { TransactionDetails } from '@/types/api-generated';

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  get: vi.fn(),
  post: vi.fn(),
  apiClient: vi.fn(),
}));

vi.mock('@/lib/api/endpoints', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/endpoints')>()),
  exportTransactions: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => '/transactions',
  useSearchParams: () => new URLSearchParams(listSearch),
}));

const mockGet = get as ReturnType<typeof vi.fn>;
const mockPost = post as ReturnType<typeof vi.fn>;
const mockApiClient = apiClient as ReturnType<typeof vi.fn>;
const mockExport = exportTransactions as unknown as ReturnType<typeof vi.fn>;

/** Stand-in for the browser EventSource (absent from jsdom). */
class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
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
    FakeEventSource.instances.push(this);
  }

  /** The server sends a named event. */
  emit(name: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) }));
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }
}

/** The list URL's search string (e.g. "search=zzz"); none by default. */
let listSearch = '';

/** In-test back-end dataset for GET /transactions. */
let dataset: TransactionDetails[] = [];

/** Page 1 of the view, honouring the status and search filters. */
function servePage(params?: unknown): unknown {
  const { status, search } = (params ?? {}) as {
    status?: string;
    search?: string;
  };
  const matching = dataset.filter(
    (d) =>
      (!status || d.status === status) &&
      (!search || d.reference.includes(search)),
  );
  const sorted = [...matching].sort((a, b) =>
    a.transactionDate < b.transactionDate ? 1 : -1,
  );
  return pageOf(sorted.map(toListItem), {
    hasAnyTransactions: dataset.length > 0,
  });
}

function routeGet(endpoint: unknown, params?: unknown): Promise<unknown> {
  const url = String(endpoint);
  if (url === '/transactions') return Promise.resolve(servePage(params));
  if (url === '/transactions/imported-count') {
    return Promise.resolve(
      createImportedTransactionCount({
        count: dataset.filter((d) => d.status === 'Imported').length,
      }),
    );
  }
  if (url === '/auth/me') return Promise.resolve(userInfoFor('Approver'));
  return Promise.reject({ message: 'Not found', statusCode: 404 });
}

function listTree() {
  return (
    <ToastProvider>
      <EventsProvider>
        <TransactionsList role="Approver" />
      </EventsProvider>
      <ToastContainer />
    </ToastProvider>
  );
}

function notifications(): HTMLElement {
  return screen.getByRole('region', { name: /notifications/i });
}

/** The inline problem beside Export (an alert outside the notifications region). */
async function findExportProblem(): Promise<HTMLElement> {
  return waitFor(() => {
    const inline = screen
      .getAllByRole('alert')
      .filter((alert) => !notifications().contains(alert));
    expect(inline).toHaveLength(1);
    return inline[0];
  });
}

describe('Epic transaction-export, Story 2: nothing to export, and export problems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    // jsdom has no object URLs; the download saves the Blob through one.
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:mock-export'),
      revokeObjectURL: vi.fn(),
    });
    dataset = seedTransactionDetails();
    listSearch = '';
    mockGet.mockImplementation((endpoint: unknown, params?: unknown) =>
      routeGet(endpoint, params),
    );
    mockApiClient.mockImplementation((endpoint: unknown) => routeGet(endpoint));
    mockPost.mockImplementation(() =>
      Promise.reject({ message: 'Unexpected post', statusCode: 500 }),
    );
    mockExport.mockImplementation(() =>
      Promise.resolve(createTransactionExport()),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // AC-1
  it('makes Export unavailable with a note beside it when nothing matches (or there are no transactions yet), and available again once the filters match', async () => {
    const user = userEvent.setup();

    // Filters that match nothing.
    listSearch = 'search=zzz';
    const view = render(listTree());
    const note = await screen.findByText(NO_MATCHES_TO_EXPORT_MESSAGE);
    const exportButton = screen.getByRole('button', { name: /^export$/i });
    expect(note).toBeVisible();
    expect(exportButton).toHaveAttribute('aria-disabled', 'true');
    expect(exportButton).toHaveAccessibleDescription(
      NO_MATCHES_TO_EXPORT_MESSAGE,
    );

    // Still reachable by keyboard, but selecting it sends nothing.
    await user.click(exportButton);
    expect(mockExport).not.toHaveBeenCalled();
    expect(
      within(notifications()).queryByText(/export downloaded/i),
    ).not.toBeInTheDocument();

    // The filters change to match a transaction: Export becomes available.
    listSearch = 'search=0030';
    view.rerender(listTree());
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /^export$/i }),
      ).not.toHaveAttribute('aria-disabled', 'true');
    });
    expect(
      screen.queryByText(NO_MATCHES_TO_EXPORT_MESSAGE),
    ).not.toBeInTheDocument();
    view.unmount();

    // No filters and no transactions at all: the "none yet" wording.
    dataset = [];
    listSearch = '';
    render(listTree());
    const noneYet = await screen.findByText(NO_TRANSACTIONS_TO_EXPORT_MESSAGE);
    expect(noneYet).toBeVisible();
    const emptyExport = screen.getByRole('button', { name: /^export$/i });
    expect(emptyExport).toHaveAttribute('aria-disabled', 'true');
    expect(emptyExport).toHaveAccessibleDescription(
      NO_TRANSACTIONS_TO_EXPORT_MESSAGE,
    );
    await user.click(emptyExport);
    expect(mockExport).not.toHaveBeenCalled();
  });

  // AC-3
  it('shows a problem with "Try again" beside Export when the connection fails, repeats the same export on Try again, and shows the server\'s message for a refusal', async () => {
    const user = userEvent.setup();
    listSearch = 'status=Imported&sortBy=Amount&sortDirection=Asc';
    const download = createTransactionExport();

    // The first attempt fails as a dropped connection; the next succeeds.
    mockExport
      .mockImplementationOnce(() =>
        Promise.reject({
          message: 'Network error',
          statusCode: 0,
          isNetworkError: true,
        }),
      )
      .mockImplementationOnce(() => Promise.resolve(download));

    const view = render(listTree());
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^export$/i }));

    const problem = await findExportProblem();
    expect(problem).toHaveTextContent('The export could not be downloaded.');
    const tryAgain = within(problem).getByRole('button', {
      name: /try again/i,
    });
    expect(
      within(notifications()).queryByText(/export downloaded/i),
    ).not.toBeInTheDocument();

    // Try again repeats the very same export query.
    const firstQuery: unknown = mockExport.mock.calls[0][0];
    expect(firstQuery).not.toHaveProperty('page');
    expect(firstQuery).not.toHaveProperty('pageSize');
    await user.click(tryAgain);
    expect(mockExport).toHaveBeenNthCalledWith(2, firstQuery);

    // It succeeds: the file is confirmed and the problem has gone.
    expect(
      await within(notifications()).findByText(/export downloaded/i),
    ).toBeInTheDocument();
    expect(
      within(notifications()).getByText(download.fileName, { exact: false }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByText('The export could not be downloaded.'),
      ).not.toBeInTheDocument();
    });
    view.unmount();

    // A refusal (403) shows the server's own message beside Export.
    listSearch = '';
    mockExport.mockImplementationOnce(() =>
      Promise.reject({
        message: FORBIDDEN_MESSAGE,
        statusCode: 403,
        body: forbiddenBody(),
      }),
    );
    render(listTree());
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^export$/i }));
    const refusal = await findExportProblem();
    expect(refusal).toHaveTextContent(FORBIDDEN_MESSAGE);
  });

  // A 409 locks Export; a live refresh that brings rows back unlocks it.
  it('makes Export available again after a 409 once a live refresh shows matching transactions, and keeps keyboard focus on Export', async () => {
    const user = userEvent.setup();
    const seeded = dataset;
    mockExport.mockImplementationOnce(() => {
      // Everything went before the export ran.
      dataset = [];
      return Promise.reject({ message: 'Conflict', statusCode: 409 });
    });

    render(listTree());
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /^export$/i }));

    const problem = await findExportProblem();
    expect(problem).toHaveTextContent(NO_TRANSACTIONS_TO_EXPORT_MESSAGE);
    const exportButton = screen.getByRole('button', { name: /^export$/i });
    await waitFor(() => {
      expect(exportButton).toHaveAttribute('aria-disabled', 'true');
    });
    expect(exportButton).toHaveFocus();

    // Transactions arrive and the list refreshes live.
    dataset = seeded;
    FakeEventSource.instances[0].emit('transactions-changed', {});
    await screen.findByRole('table');
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /^export$/i }),
      ).not.toHaveAttribute('aria-disabled', 'true');
    });
    expect(
      screen.queryByText(NO_TRANSACTIONS_TO_EXPORT_MESSAGE),
    ).not.toBeInTheDocument();
  });
});
