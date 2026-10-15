/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: app-frontend/src/app/(authenticated)/transactions/page.tsx
 *   (client list at app-frontend/src/components/transactions/TransactionsList.tsx,
 *    filter form at app-frontend/src/components/transactions/TransactionFilters.tsx)
 * - Page Action: modify_existing
 *
 * Tests for Epic transactions-list, Story 2: Filter and search transactions.
 * Vitest covers AC-4 and AC-5 only (AC-1, AC-2, AC-3, AC-6 are Playwright).
 *
 * Render scope: the client components directly. The page itself stays an async server
 * component wrapped in `RouteGuard route="/transactions"`, which jsdom cannot render, and
 * renders `<TransactionsList />` inside the guard.
 *
 * Contracts these tests pin (the developer implements to them):
 * - `@/components/transactions/TransactionsList` exports `TransactionsList`, a client
 *   component with no required props. It reads list state (filters, sort, page, pageSize)
 *   from `useSearchParams()`, loads with `getTransactions` (GET /transactions via the API
 *   client) and uses the shell's `useEvents()` (inside `EventsProvider`).
 * - `@/components/transactions/TransactionFilters` exports `TransactionFilters`, a client
 *   component with no required props. It reads the current filters from
 *   `useSearchParams()`, loads file options itself with `getFiles` (GET /files), and
 *   applies filters by `useRouter().push(<url string with the filter query>)`.
 *   It renders ONE inline filter form in the DOM (a phone Sheet may hold another
 *   instance only while open). Uses react-hook-form, `mode: 'onBlur'`,
 *   `reValidateMode: 'onBlur'`, zod for the range checks.
 * - Field labels: "Minimum amount", "Maximum amount", "From date", "To date"
 *   (native `<input type="date">`); the submit button's name contains "Apply".
 * - Range errors sit on the FIRST field of the range (AC-5 "on that field"):
 *   min above max -> message on Minimum amount mentioning "maximum";
 *   start after end -> message on From date mentioning the "to"/"end" date.
 *   The field gets `aria-invalid="true"` and `aria-describedby` pointing at the message.
 *   While a range is invalid no navigation carries that range.
 * - No-match state (`hasAnyTransactions: true`, zero items): a `<section>` labelled by
 *   its heading "No transactions match ..." that lists the active filters (status
 *   word, file NAME, search text) and holds a "Clear all filters" button. Clearing
 *   pushes a URL with no status / fileId / search. "No transactions yet" never appears
 *   at the same time.
 *
 * Only `@/lib/api/client` and `next/navigation` are mocked; jsdom has no EventSource,
 * so the browser API is replaced with an inert stand-in for the real EventsProvider.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Imports below target not-yet-built modules - will fail until implemented (TDD red).
import { TransactionsList } from '@/components/transactions/TransactionsList';
import { TransactionFilters } from '@/components/transactions/TransactionFilters';
import { EventsProvider } from '@/contexts/EventsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { get } from '@/lib/api/client';
// Project-wide mock data shared with the Playwright layer.
import { pageOf, seedTransactions } from '@/mocks/data/transactions';
import { SEEDED_FILE_IDS, filePageOf, seedFiles } from '@/mocks/data/files';

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
  usePathname: () => '/transactions',
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

/** Inert stand-in for the browser EventSource (absent from jsdom). */
class InertEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readonly url: string;
  readonly withCredentials = false;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
  }

  close(): void {
    this.readyState = 2;
  }
}

/** Serve GET /transactions and GET /files from the shared mock data. */
function serveApi(transactionsResponse: ReturnType<typeof pageOf>): void {
  mockGet.mockImplementation((path: string) => {
    if (path.startsWith('/transactions')) {
      return Promise.resolve(transactionsResponse);
    }
    if (path.startsWith('/files')) {
      return Promise.resolve(filePageOf(seedFiles(), { pageSize: 50 }));
    }
    return Promise.reject(new Error(`Unexpected GET ${path} in this test`));
  });
}

/** Every URL the component navigated to (push or replace), as strings. */
function navigatedUrls(): string[] {
  return [...navigation.push.mock.calls, ...navigation.replace.mock.calls].map(
    (call) => String(call[0]),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  navigation.search = new URLSearchParams();
  vi.stubGlobal('EventSource', InertEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Epic transactions-list, Story 2: no-match state', () => {
  // AC-4
  // Data-contract: full chain verified during manual checklist
  it('says no transactions match, lists the active filters and clears them, without "No transactions yet"', async () => {
    const user = userEvent.setup();
    navigation.search = new URLSearchParams({
      status: 'Rejected',
      fileId: SEEDED_FILE_IDS.aprilBatch2,
      search: 'TXN-2099',
    });
    serveApi(pageOf([], { hasAnyTransactions: true }));

    render(
      <ToastProvider>
        <EventsProvider>
          <TransactionsList />
        </EventsProvider>
      </ToastProvider>,
    );

    const noMatch = await screen.findByRole('region', {
      name: /no transactions match/i,
    });
    expect(screen.queryByText(/no transactions yet/i)).not.toBeInTheDocument();

    // The active filters are shown with the no-match message (file by its name).
    expect(within(noMatch).getByText(/rejected/i)).toBeInTheDocument();
    expect(
      await within(noMatch).findByText(/april-batch-2\.csv/i),
    ).toBeInTheDocument();
    expect(within(noMatch).getByText(/TXN-2099/)).toBeInTheDocument();

    // One action clears them all.
    navigation.push.mockClear();
    navigation.replace.mockClear();
    await user.click(
      within(noMatch).getByRole('button', { name: /clear all filters/i }),
    );
    await waitFor(() => {
      expect(navigatedUrls()).toContainEqual(
        expect.not.stringMatching(/(^|[?&])(status|fileId|search)=/),
      );
    });
  });
});

describe('Epic transactions-list, Story 2: range validation', () => {
  // AC-5
  it('shows a message on the field for min above max and start after end, and applies no invalid range', async () => {
    const user = userEvent.setup();
    serveApi(pageOf(seedTransactions()));

    render(
      <ToastProvider>
        <TransactionFilters />
      </ToastProvider>,
    );

    // Amount range: minimum above maximum, checked on leaving the field.
    const minAmount = await screen.findByLabelText(/^min(imum)? amount/i);
    const maxAmount = screen.getByLabelText(/^max(imum)? amount/i);
    await user.type(maxAmount, '100');
    await user.type(minAmount, '5000');
    await user.tab();
    await waitFor(() => {
      expect(minAmount).toHaveAccessibleDescription(/maximum/i);
    });
    expect(minAmount).toHaveAttribute('aria-invalid', 'true');

    // Date range: start after end, checked on leaving the field.
    const fromDate = screen.getByLabelText(/^(from|start) date/i);
    const toDate = screen.getByLabelText(/^(to|end) date/i);
    await user.type(toDate, '2026-04-10');
    await user.type(fromDate, '2026-04-20');
    await user.tab();
    await waitFor(() => {
      expect(fromDate).toHaveAccessibleDescription(/(to|end) date/i);
    });
    expect(fromDate).toHaveAttribute('aria-invalid', 'true');

    // Submitting keeps the messages and does not apply the invalid ranges.
    await user.click(screen.getByRole('button', { name: /apply/i }));
    expect(minAmount).toHaveAccessibleDescription(/maximum/i);
    expect(fromDate).toHaveAccessibleDescription(/(to|end) date/i);

    // Correct both ranges and apply: now the ranges reach the URL.
    await user.clear(minAmount);
    await user.type(minAmount, '50');
    await user.clear(fromDate);
    await user.type(fromDate, '2026-04-05');
    await user.click(screen.getByRole('button', { name: /apply/i }));
    await waitFor(() => {
      expect(navigatedUrls()).toContainEqual(
        expect.stringMatching(/minAmount=50(\.0+)?(&|$)/),
      );
    });
    expect(navigatedUrls()).toContainEqual(
      expect.stringMatching(/dateFrom=2026-04-05(&|$)/),
    );
    expect(minAmount).not.toHaveAttribute('aria-invalid', 'true');
    expect(fromDate).not.toHaveAttribute('aria-invalid', 'true');

    // The earlier invalid ranges were never applied.
    expect(navigatedUrls()).not.toContainEqual(
      expect.stringMatching(/minAmount=5000/),
    );
    expect(navigatedUrls()).not.toContainEqual(
      expect.stringMatching(/dateFrom=2026-04-20/),
    );
  });
});

describe('Epic transactions-list, Story 2: filters from a link', () => {
  /** The query of every GET /transactions the list sent. */
  function transactionQueries(): Record<string, unknown>[] {
    return mockGet.mock.calls
      .filter(([path]) => path === '/transactions')
      .map(([, params]) => (params ?? {}) as Record<string, unknown>);
  }

  // AC-3, AC-5
  it.each([
    {
      case: 'a negative amount',
      url: { minAmount: '-5', maxAmount: '900' },
      dropped: ['minAmount'],
    },
    {
      case: 'a date not in yyyy-MM-dd form',
      url: { dateFrom: '15/04/2026', dateTo: '2026-04-30' },
      dropped: ['dateFrom'],
    },
    {
      case: 'a minimum above the maximum',
      url: { minAmount: '500', maxAmount: '100' },
      dropped: ['minAmount', 'maxAmount'],
    },
    {
      case: 'a start date after the end date',
      url: { dateFrom: '2026-04-20', dateTo: '2026-04-10' },
      dropped: ['dateFrom', 'dateTo'],
    },
  ])(
    'ignores $case in the URL instead of sending it to the API',
    async ({ url, dropped }) => {
      navigation.search = new URLSearchParams({ status: 'Approved', ...url });
      serveApi(pageOf(seedTransactions()));

      render(
        <ToastProvider>
          <EventsProvider>
            <TransactionsList />
          </EventsProvider>
        </ToastProvider>,
      );

      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /retry/i }),
      ).not.toBeInTheDocument();
      const [query] = transactionQueries();
      expect(query.status).toBe('Approved');
      for (const key of dropped) {
        expect(query).not.toHaveProperty(key);
      }
      for (const [key, value] of Object.entries(url)) {
        if (!dropped.includes(key)) {
          expect(String(query[key])).toBe(value);
        }
      }
    },
  );
});

describe('Epic transactions-list, Story 2: file names', () => {
  // AC-4
  it('loads the file list once for the filter form and the no-match state together', async () => {
    navigation.search = new URLSearchParams({
      fileId: SEEDED_FILE_IDS.aprilBatch2,
    });
    serveApi(pageOf([], { hasAnyTransactions: true }));

    render(
      <ToastProvider>
        <EventsProvider>
          <TransactionFilters />
          <TransactionsList />
        </EventsProvider>
      </ToastProvider>,
    );

    const noMatch = await screen.findByRole('region', {
      name: /no transactions match/i,
    });
    expect(
      await within(noMatch).findByText(/april-batch-2\.csv/i),
    ).toBeInTheDocument();
    const fileRequests = mockGet.mock.calls.filter(([path]) =>
      String(path).startsWith('/files'),
    );
    expect(fileRequests).toHaveLength(1);
  });
});
