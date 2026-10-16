/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: app-frontend/src/components/transactions/TransactionsList.tsx
 * - Page Action: modify_existing
 *
 * Tests for Epic transaction-export, Story 1: export the filtered transactions.
 * Vitest covers AC-1 and AC-5 (AC-2, AC-3 and AC-4, the real download and its
 * bytes, are Playwright).
 *
 * Render scope: the page reads the signed-in role on the server (`requireSession()`),
 * which jsdom cannot run, so the list is rendered through its client component
 * `TransactionsList` with the role passed in, inside the providers the real layouts
 * mount (ToastProvider + ToastContainer + EventsProvider).
 *
 * Implementation contract these tests assume:
 * - For `role === 'Approver'`, `TransactionsList` shows a text button named "Export"
 *   above the list. An Importer gets no Export button at all (hidden, not disabled),
 *   and still no Approve / Reject.
 * - Selecting Export requests `GET /transactions/export` through `@/lib/api` (the API
 *   client, or a helper in `lib/api/` built on `fetch`), never `fetch` from the
 *   component. HOW the endpoint function hands back the file name is not pinned
 *   here: the in-test back-end answers at the `fetch` boundary with the real
 *   `Content-Type` and `Content-Disposition` headers, and only the user-visible
 *   result is asserted. (The mocked `apiClient` passes export calls to the real
 *   client so they reach that `fetch`; every other call is served in-test.)
 * - While the request runs the button reads "Exporting…" and is disabled, so it
 *   cannot be started twice.
 * - On 200 the Blob is saved through `URL.createObjectURL` (stubbed here; jsdom
 *   lacks it) and a `success` toast "Export downloaded" names the file from
 *   `Content-Disposition`; it closes on its own (ToastContext's 5 s default).
 *
 * Data-contract: the back-end is mocked; the real proxy -> back-end chain and the
 * file's bytes are verified by the Playwright spec and the manual checklist.
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Will fail until implemented (TDD red): the Export button and its download.
import { TransactionsList } from '@/components/transactions/TransactionsList';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { EventsProvider } from '@/contexts/EventsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { apiClient, get, post } from '@/lib/api/client';
// Project-wide mock data shared with the Playwright layer (never re-defined here).
import { createImportedTransactionCount } from '@/mocks/data/importedCount';
import { userInfoFor } from '@/mocks/data/identity';
import {
  createTransactionExport,
  exportCsvOf,
  exportResponseHeaders,
} from '@/mocks/data/transactionExport';
import {
  pageOf,
  seedTransactionDetails,
  seededTransactionReference,
  toListItem,
} from '@/mocks/data/transactions';
import type { APIRequestConfig } from '@/types/api';
import type { TransactionDetails, UserRole } from '@/types/api-generated';

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  get: vi.fn(),
  post: vi.fn(),
  apiClient: vi.fn(),
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

/** Stand-in for the browser EventSource (absent from jsdom). */
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

/** The list URL's search string (e.g. "status=Imported"); none by default. */
let listSearch = '';

/** In-test back-end state, read on every request. */
let dataset: TransactionDetails[] = [];
let signedInRole: UserRole = 'Approver';

/** The real API client, used only to carry export calls to the stubbed `fetch`. */
let realApiClient: typeof apiClient;

/** Answers `GET /transactions/export` at the fetch boundary. */
let answerExport: () => Promise<Response>;

const EXPORT_PATH = '/transactions/export';

/** Page 1 of the view (transaction date, newest first), honouring `status`. */
function servePage(params?: unknown): unknown {
  const status = (params as { status?: string } | undefined)?.status;
  const matching = status
    ? dataset.filter((d) => d.status === status)
    : dataset;
  const sorted = [...matching].sort((a, b) =>
    a.transactionDate < b.transactionDate ? 1 : -1,
  );
  return pageOf(sorted.map(toListItem));
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
  if (url === '/auth/me') return Promise.resolve(userInfoFor(signedInRole));
  return Promise.reject({ message: 'Not found', statusCode: 404 });
}

/** The mocked `apiClient`: export calls go to the real client, the rest in-test. */
function routeApiClient(
  endpoint: unknown,
  config?: APIRequestConfig,
): Promise<unknown> {
  const url = String(endpoint);
  if (url.startsWith(EXPORT_PATH)) return realApiClient(url, config);
  return routeGet(endpoint, config?.params);
}

/** The stubbed browser `fetch`: only the export reaches it. */
function routeFetch(input: unknown): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  if (url.includes(EXPORT_PATH)) return answerExport();
  return Promise.resolve(
    new Response(JSON.stringify({ message: 'Not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

/** The 200 export of the seeded Imported transactions, saved as `fileName`. */
function exportResponse(fileName: string): Response {
  const imported = dataset
    .filter((d) => d.status === 'Imported')
    .sort((a, b) => (a.transactionDate < b.transactionDate ? 1 : -1));
  return new Response(exportCsvOf(imported), {
    status: 200,
    headers: exportResponseHeaders(fileName),
  });
}

function renderList(role: UserRole) {
  signedInRole = role;
  return render(
    <ToastProvider>
      <EventsProvider>
        <TransactionsList role={role} />
      </EventsProvider>
      <ToastContainer />
    </ToastProvider>,
  );
}

const exportName = /^export$/i;
const exportingName = /^exporting/i;
const anyDecision = /^(approve|reject)\b/i;

describe('Epic transaction-export, Story 1: export the filtered transactions', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn(routeFetch));
    // jsdom has no object URLs; the download saves the Blob through one.
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:mock-export'),
      revokeObjectURL: vi.fn(),
    });
    const actual =
      await vi.importActual<typeof import('@/lib/api/client')>(
        '@/lib/api/client',
      );
    realApiClient = actual.apiClient;
    dataset = seedTransactionDetails();
    signedInRole = 'Approver';
    listSearch = '';
    answerExport = () =>
      Promise.resolve(exportResponse(createTransactionExport().fileName));
    mockGet.mockImplementation((endpoint: unknown, params?: unknown) =>
      routeGet(endpoint, params),
    );
    mockApiClient.mockImplementation(
      (endpoint: unknown, config?: APIRequestConfig) =>
        routeApiClient(endpoint, config),
    );
    mockPost.mockImplementation(() =>
      Promise.reject({ message: 'Unexpected post', statusCode: 500 }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // AC-1
  it('gives an Approver an Export button on the Transactions screen, and gives an Importer no Export and no Approve or Reject', async () => {
    const approverView = renderList('Approver');
    await screen.findByRole('table');
    const exportButton = screen.getByRole('button', { name: exportName });
    expect(exportButton).toBeEnabled();
    approverView.unmount();

    // Importer: no Export anywhere (hidden, not disabled), and still no decisions.
    renderList('Importer');
    const table = await screen.findByRole('table');
    const imported = seededTransactionReference(30);
    expect(
      within(table).getByRole('link', { name: imported }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /export/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: anyDecision }),
    ).not.toBeInTheDocument();
  });

  // AC-5
  it('shows progress and locks Export while the file downloads, then shows a success message naming the server’s file that closes on its own', async () => {
    // The toast's auto-dismiss is a component-local timer; time still moves on
    // its own so the list's loading and RTL's polling behave normally.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout'],
      shouldAdvanceTime: true,
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    listSearch = 'status=Imported';
    // A name the browser could not compose from today's filters (an old date):
    // it can only have come from Content-Disposition.
    const { fileName } = createTransactionExport();

    // The export hangs until we let the file arrive.
    let arrive: () => void = () => {};
    answerExport = () =>
      new Promise<Response>((resolve) => {
        arrive = () => resolve(exportResponse(fileName));
      });

    renderList('Approver');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: exportName }));

    // In progress: Export shows progress and cannot be started again.
    const busy = await screen.findByRole('button', { name: exportingName });
    expect(busy).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: exportName }),
    ).not.toBeInTheDocument();

    // The file arrives: Export is ready again and a success message names the file.
    await act(async () => {
      arrive();
    });
    expect(
      await screen.findByRole('button', { name: exportName }),
    ).toBeEnabled();
    const notifications = screen.getByRole('region', {
      name: /notifications/i,
    });
    const success = await within(notifications).findByRole('status');
    expect(success).toHaveTextContent('Export downloaded');
    expect(success).toHaveTextContent(fileName);

    // It closes on its own.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(within(notifications).queryByText(fileName)).not.toBeInTheDocument();
  });
});
