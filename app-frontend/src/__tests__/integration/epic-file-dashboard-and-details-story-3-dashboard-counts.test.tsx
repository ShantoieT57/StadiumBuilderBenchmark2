/**
 * Story Metadata:
 * - Route: /dashboard
 * - Target File: app-frontend/src/app/(authenticated)/dashboard/page.tsx
 *   (the page stays a server component wrapped in `RouteGuard route="/dashboard"`,
 *   which jsdom cannot render; it renders the client counts strip
 *   `@/components/files/DashboardCounts` above the file list)
 * - Page Action: modify_existing
 *
 * Tests for Epic file-dashboard-and-details, Story 3: Dashboard status and
 * transaction counts. Vitest covers AC-1, AC-4 and AC-5 (AC-2, AC-3, AC-6 are
 * Playwright).
 *
 * Contracts these tests pin (the developer implements to them):
 * - `@/components/files/DashboardCounts` exports `DashboardCounts`, a client component
 *   with no required props. It loads the counts with `getDashboardSummary()` from
 *   `@/lib/api/endpoints` (GET /dashboard/summary) and owns its own loading / problem
 *   states, so the file list beside it is never blocked.
 * - The whole strip is one landmark: `<section aria-label="Dashboard summary">`
 *   (role `region`, name "Dashboard summary") in every state (loading, problem, loaded).
 * - Loaded: two headings, "Files" and "Transactions". Each count is a link whose
 *   accessible name holds the number and the status in words, e.g. "4 Completed",
 *   "15 Imported" (Uploaded, Processing, Completed, Failed; Imported, Approved, Rejected).
 * - Loading: the text "Loading counts" while the first load is pending.
 * - Problem: an inline problem inside the region with a "Retry" button that loads again.
 * - Live refresh: subscribes through `useEvents()` (from `@/contexts/EventsContext`) to
 *   `file-changed`, `transactions-changed` and `resync`, and refetches in place (the
 *   previous counts stay on screen, no loading state, while the refetch is pending).
 *
 * jsdom has no EventSource, so the browser API is replaced by an in-test fake and the
 * real EventsProvider is used. Only `@/lib/api/client` and `next/navigation` are mocked;
 * the mocked `get` serves the shared `createDashboardSummary` factory.
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Target module - will fail until implemented (TDD red).
import { DashboardCounts } from '@/components/files/DashboardCounts';
import { EventsProvider } from '@/contexts/EventsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { get } from '@/lib/api/client';
import { createDashboardSummary } from '@/mocks/data/dashboardSummary';
import { DASHBOARD_FILE_IDS } from '@/mocks/data/files';
import type { DashboardSummary } from '@/types/api-generated';

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

/** In-test back-end: the summary GET /dashboard/summary currently returns. */
let summary: DashboardSummary = createDashboardSummary();

function serveSummary(): void {
  mockGet.mockImplementation(async (endpoint: unknown) => {
    if (endpoint !== '/dashboard/summary') {
      throw { message: `Unexpected call ${String(endpoint)}`, statusCode: 404 };
    }
    return summary;
  });
}

function renderCounts() {
  return render(
    <ToastProvider>
      <EventsProvider>
        <DashboardCounts />
      </EventsProvider>
      <ToastContainer />
    </ToastProvider>,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A link whose name holds both the status word and exactly this number. */
function countName(status: string, count: number): RegExp {
  return new RegExp(
    `^(?=.*\\b${escapeRegExp(status)}\\b)(?=.*(^|\\D)${count}(\\D|$))`,
  );
}

function summaryRegion(): HTMLElement {
  return screen.getByRole('region', { name: 'Dashboard summary' });
}

describe('Epic file-dashboard-and-details, Story 3: Dashboard counts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.search = new URLSearchParams();
    FakeEventSource.connections = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    summary = createDashboardSummary();
    serveSummary();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // AC-1
  it('shows the number of files in each status and of Imported, Approved and Rejected transactions, each labelled in words', async () => {
    renderCounts();

    const region = await screen.findByRole('region', {
      name: 'Dashboard summary',
    });
    const strip = within(region);
    expect(
      await strip.findByRole('link', { name: countName('Completed', 4) }),
    ).toBeInTheDocument();

    expect(strip.getByRole('heading', { name: 'Files' })).toBeInTheDocument();
    expect(
      strip.getByRole('heading', { name: 'Transactions' }),
    ).toBeInTheDocument();

    expect(
      strip.getByRole('link', { name: countName('Uploaded', 1) }),
    ).toBeInTheDocument();
    expect(
      strip.getByRole('link', { name: countName('Processing', 1) }),
    ).toBeInTheDocument();
    expect(
      strip.getByRole('link', { name: countName('Failed', 3) }),
    ).toBeInTheDocument();
    expect(
      strip.getByRole('link', { name: countName('Imported', 15) }),
    ).toBeInTheDocument();
    expect(
      strip.getByRole('link', { name: countName('Approved', 10) }),
    ).toBeInTheDocument();
    expect(
      strip.getByRole('link', { name: countName('Rejected', 5) }),
    ).toBeInTheDocument();
  });

  // AC-4
  it('shows a loading state, then a problem with Retry inside the summary when the load fails, and Retry loads the counts', async () => {
    const user = userEvent.setup();

    // Loading: the first load has not answered yet.
    let answer: (value: DashboardSummary) => void = () => undefined;
    mockGet.mockImplementationOnce(
      () =>
        new Promise<DashboardSummary>((resolve) => {
          answer = resolve;
        }),
    );
    const loading = renderCounts();
    expect(
      within(summaryRegion()).getByText(/loading counts/i),
    ).toBeInTheDocument();
    await act(async () => {
      answer(createDashboardSummary());
    });
    expect(
      within(summaryRegion()).getByRole('link', {
        name: countName('Completed', 4),
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/loading counts/i)).not.toBeInTheDocument();
    loading.unmount();

    // Problem: contained in the summary region, with Retry; Retry loads the counts.
    mockGet.mockRejectedValueOnce({
      message: 'Something went wrong',
      statusCode: 500,
    });
    renderCounts();
    const retry = await within(summaryRegion()).findByRole('button', {
      name: /retry/i,
    });
    expect(
      screen.queryByRole('link', { name: countName('Completed', 4) }),
    ).not.toBeInTheDocument();

    await user.click(retry);

    expect(
      await within(summaryRegion()).findByRole('link', {
        name: countName('Completed', 4),
      }),
    ).toBeInTheDocument();
    expect(
      within(summaryRegion()).getByRole('link', {
        name: countName('Imported', 15),
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /retry/i }),
    ).not.toBeInTheDocument();
  });

  // AC-5
  it('refreshes the counts in place on file-changed, transactions-changed and resync', async () => {
    renderCounts();

    const strip = within(
      await screen.findByRole('region', { name: 'Dashboard summary' }),
    );
    expect(
      await strip.findByRole('link', { name: countName('Processing', 1) }),
    ).toBeInTheDocument();

    const [connection] = FakeEventSource.connections;
    expect(connection).toBeDefined();

    // file-changed: the processing file completed. The refetch is held open to
    // prove the previous counts stay on screen (in place, no loading state).
    let answer: (value: DashboardSummary) => void = () => undefined;
    mockGet.mockImplementationOnce(
      () =>
        new Promise<DashboardSummary>((resolve) => {
          answer = resolve;
        }),
    );
    summary = createDashboardSummary({
      files: { processing: 0, completed: 5 },
    });
    act(() =>
      connection.emit('file-changed', {
        fileId: DASHBOARD_FILE_IDS.processing,
        status: 'Completed',
        isCancelled: false,
      }),
    );
    expect(
      strip.getByRole('link', { name: countName('Processing', 1) }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/loading counts/i)).not.toBeInTheDocument();
    await act(async () => {
      answer(summary);
    });
    expect(
      await strip.findByRole('link', { name: countName('Completed', 5) }),
    ).toBeInTheDocument();
    expect(
      strip.getByRole('link', { name: countName('Processing', 0) }),
    ).toBeInTheDocument();

    // transactions-changed: two imported transactions were approved.
    summary = createDashboardSummary({
      files: { processing: 0, completed: 5 },
      transactions: { imported: 13, approved: 12 },
    });
    act(() =>
      connection.emit('transactions-changed', {
        fileId: DASHBOARD_FILE_IDS.aprilBatch1,
      }),
    );
    expect(
      await strip.findByRole('link', { name: countName('Approved', 12) }),
    ).toBeInTheDocument();
    expect(
      strip.getByRole('link', { name: countName('Imported', 13) }),
    ).toBeInTheDocument();

    // resync: the back-end now reports a further rejection.
    summary = createDashboardSummary({
      files: { processing: 0, completed: 5 },
      transactions: { imported: 12, approved: 12, rejected: 6 },
    });
    act(() => connection.emit('resync', {}));
    expect(
      await strip.findByRole('link', { name: countName('Rejected', 6) }),
    ).toBeInTheDocument();
    expect(
      strip.getByRole('link', { name: countName('Imported', 12) }),
    ).toBeInTheDocument();
  });

  // AC-2
  it('links a file count to that status among active files, keeping the sort, page size and other filters', async () => {
    // Cancelled files are shown, but the counts only cover active files.
    navigation.search = new URLSearchParams({
      sortBy: 'FileName',
      sortDirection: 'Asc',
      pageSize: '5',
      page: '2',
      fileName: 'april',
      visibility: 'Cancelled',
    });
    renderCounts();

    const link = await within(summaryRegion()).findByRole('link', {
      name: countName('Completed', 4),
    });
    const url = new URL(link.getAttribute('href') ?? '', 'http://localhost');
    expect(url.pathname).toBe('/dashboard');
    expect(url.searchParams.get('status')).toBe('Completed');
    expect(url.searchParams.get('visibility')).toBeNull();
    expect(url.searchParams.get('page')).toBeNull();
    expect(url.searchParams.get('sortBy')).toBe('FileName');
    expect(url.searchParams.get('sortDirection')).toBe('Asc');
    expect(url.searchParams.get('pageSize')).toBe('5');
    expect(url.searchParams.get('fileName')).toBe('april');
  });

  // AC-4, AC-5
  it('keeps the counts with a small problem and Retry when a live refresh fails', async () => {
    const user = userEvent.setup();
    renderCounts();
    const strip = within(summaryRegion());
    expect(
      await strip.findByRole('link', { name: countName('Processing', 1) }),
    ).toBeInTheDocument();
    const [connection] = FakeEventSource.connections;

    mockGet.mockRejectedValueOnce({
      message: 'Something went wrong',
      statusCode: 500,
    });
    act(() =>
      connection.emit('file-changed', {
        fileId: DASHBOARD_FILE_IDS.processing,
        status: 'Completed',
        isCancelled: false,
      }),
    );
    expect(await strip.findByRole('alert')).toHaveTextContent(
      "Couldn't refresh — showing earlier data",
    );
    expect(
      strip.getByRole('link', { name: countName('Processing', 1) }),
    ).toBeInTheDocument();

    summary = createDashboardSummary({
      files: { processing: 0, completed: 5 },
    });
    await user.click(strip.getByRole('button', { name: 'Retry' }));
    expect(
      await strip.findByRole('link', { name: countName('Completed', 5) }),
    ).toBeInTheDocument();
    expect(strip.queryByRole('alert')).not.toBeInTheDocument();
  });
});
