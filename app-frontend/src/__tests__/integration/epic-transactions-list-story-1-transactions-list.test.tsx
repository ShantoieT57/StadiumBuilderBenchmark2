/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: app-frontend/src/app/(authenticated)/transactions/page.tsx
 *   (the page stays a server component wrapped in `RouteGuard route="/transactions"`
 *   and renders the client list `@/components/transactions/TransactionsList`)
 * - Page Action: modify_existing
 *
 * Tests for Epic transactions-list, Story 1: Transactions list with sorting, paging
 * and phone layout. Vitest covers AC-1, AC-4 and AC-6 (AC-2, AC-3, AC-5 are Playwright).
 *
 * Contracts these tests pin (the developer implements to them):
 * - `@/components/transactions/TransactionsList` exports `TransactionsList`, a client
 *   component with no required props. It reads the list state from
 *   `useSearchParams()` (`sortBy`, `sortDirection` as `Asc`|`Desc`, `page`, `pageSize`;
 *   defaults TransactionDate / Desc / 1 / 20) and loads it with `getTransactions(...)`
 *   from `@/lib/api/endpoints`, passing those values as the query.
 * - The desktop layout is a `<table>` with one row per transaction. The phone layout
 *   (compact rows) may also be in the DOM, toggled by CSS; these tests scope to the table.
 * - Each table row shows: reference, the date and time exactly as sent formatted
 *   `yyyy-MM-dd HH:mm` (e.g. `2026-04-15 23:30`, no timezone conversion), account
 *   number, description, amount cell as `<2 decimals, en-US grouping> <currency>`
 *   in one text node (e.g. `15,750.00 ZAR`), `Credit`/`Debit`, the status in words, and the file name.
 * - States: a loading state with the text "Loading transactions" while the first load
 *   is pending; a failed load shows an inline problem with a "Retry" button that loads
 *   again; `hasAnyTransactions: false` shows "No transactions yet".
 * - Live refresh: subscribes through `useEvents()` (from `@/contexts/EventsContext`) to
 *   `transactions-changed` and `resync`, and refetches with the current URL params.
 *
 * jsdom has no EventSource, so the browser API is replaced by an in-test fake and the
 * real EventsProvider is used. Only `@/lib/api/client` and `next/navigation` are mocked;
 * the mocked `get` serves the shared seeded dataset, honouring sort and paging params.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Target module - will fail until implemented (TDD red).
import { TransactionsList } from '@/components/transactions/TransactionsList';
import { EventsProvider } from '@/contexts/EventsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { get } from '@/lib/api/client';
import {
  createTransaction,
  pageOf,
  seedTransactions,
} from '@/mocks/data/transactions';
import { seededTransactionFiles } from '@/mocks/data/files';
import type {
  TransactionListItem,
  TransactionPage,
  TransactionSortColumn,
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

function sortValue(
  item: TransactionListItem,
  column: TransactionSortColumn,
): string | number {
  switch (column) {
    case 'Amount':
      return item.amount;
    case 'Reference':
      return item.reference;
    case 'AccountNumber':
      return item.accountNumber;
    case 'Description':
      return item.description;
    case 'Currency':
      return item.currency;
    case 'TransactionType':
      return item.transactionType;
    case 'Status':
      return item.status;
    case 'FileName':
      return item.file.fileName;
    default:
      return item.transactionDate;
  }
}

/** In-test back-end: serves `dataset` sorted and paged per the query it receives. */
let dataset: TransactionListItem[] = [];

function servePage(params: unknown): TransactionPage {
  const query = (params ?? {}) as Record<string, unknown>;
  const sortBy =
    (query.sortBy as TransactionSortColumn | undefined) ?? 'TransactionDate';
  const direction =
    query.sortDirection ?? (sortBy === 'TransactionDate' ? 'Desc' : 'Asc');
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);
  const sorted = [...dataset].sort((a, b) => {
    const left = sortValue(a, sortBy);
    const right = sortValue(b, sortBy);
    const order = left < right ? -1 : left > right ? 1 : 0;
    return direction === 'Desc' ? -order : order;
  });
  return pageOf(sorted, { page, pageSize });
}

function serveFromDataset(): void {
  mockGet.mockImplementation(async (endpoint: unknown, params?: unknown) => {
    if (endpoint !== '/transactions') {
      throw { message: `Unexpected call ${String(endpoint)}`, statusCode: 404 };
    }
    return servePage(params);
  });
}

function renderList() {
  return render(
    <ToastProvider>
      <EventsProvider>
        <TransactionsList />
      </EventsProvider>
      <ToastContainer />
    </ToastProvider>,
  );
}

function rowFor(table: HTMLElement, reference: string): HTMLElement {
  return within(table).getByRole('row', { name: new RegExp(reference) });
}

describe('Epic transactions-list, Story 1: Transactions list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.search = new URLSearchParams();
    FakeEventSource.connections = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    dataset = seedTransactions();
    serveFromDataset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // AC-1
  it('shows every field of a transaction in its row, with the date as sent and the amount to 2 decimals with its currency', async () => {
    dataset = [
      createTransaction({
        reference: 'TXN-20260415-0001',
        transactionDate: '2026-04-15T23:30:00',
        accountNumber: '1001-2034-5567',
        description: 'Salary deposit - Acme Holdings',
        amount: 15750,
        currency: 'ZAR',
        transactionType: 'Credit',
        status: 'Imported',
        file: { ...seededTransactionFiles.aprilBatch1 },
      }),
      createTransaction({
        id: '5d0c9b10-0000-4000-8000-000000000002',
        reference: 'TXN-20260414-0002',
        transactionDate: '2026-04-14T07:05:00',
        accountNumber: '2002-7781-3346',
        description: 'Municipal rates - City of Johannesburg',
        amount: 89.9,
        currency: 'ZAR',
        transactionType: 'Debit',
        status: 'Rejected',
        file: { ...seededTransactionFiles.aprilBatch2 },
      }),
    ];

    renderList();

    const table = await screen.findByRole('table');
    await waitFor(() =>
      expect(rowFor(table, 'TXN-20260415-0001')).toBeInTheDocument(),
    );

    const credit = within(rowFor(table, 'TXN-20260415-0001'));
    expect(credit.getByText(/2026-04-15 23:30/)).toBeInTheDocument();
    expect(credit.getByText('1001-2034-5567')).toBeInTheDocument();
    expect(
      credit.getByText('Salary deposit - Acme Holdings'),
    ).toBeInTheDocument();
    expect(credit.getByText(/15,750\.00 ZAR/)).toBeInTheDocument();
    expect(credit.getByText('Credit')).toBeInTheDocument();
    expect(credit.getByText('Imported')).toBeInTheDocument();
    expect(credit.getByText('april-batch-1.csv')).toBeInTheDocument();

    const debit = within(rowFor(table, 'TXN-20260414-0002'));
    expect(debit.getByText(/2026-04-14 07:05/)).toBeInTheDocument();
    expect(debit.getByText(/89\.90 ZAR/)).toBeInTheDocument();
    expect(debit.getByText('Debit')).toBeInTheDocument();
    expect(debit.getByText('Rejected')).toBeInTheDocument();
    expect(debit.getByText('april-batch-2.csv')).toBeInTheDocument();
  });

  // AC-4
  it('shows a loading state, a problem with Retry when the load fails, and "No transactions yet" when there are none', async () => {
    const user = userEvent.setup();

    // Loading: the first load has not answered yet.
    let answer: (page: TransactionPage) => void = () => undefined;
    mockGet.mockImplementationOnce(
      () =>
        new Promise<TransactionPage>((resolve) => {
          answer = resolve;
        }),
    );
    const loading = renderList();
    expect(
      await screen.findByText(/loading transactions/i),
    ).toBeInTheDocument();
    await act(async () => {
      answer(servePage(undefined));
    });
    expect(
      within(await screen.findByRole('table')).getByRole('row', {
        name: /TXN-20260430-0030/,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/loading transactions/i)).not.toBeInTheDocument();
    loading.unmount();

    // Failure: an inline problem with Retry; Retry loads the list.
    mockGet.mockRejectedValueOnce({
      message: 'Something went wrong',
      statusCode: 500,
    });
    const failing = renderList();
    const retry = await screen.findByRole('button', { name: /retry/i });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await user.click(retry);
    expect(
      within(await screen.findByRole('table')).getByRole('row', {
        name: /TXN-20260430-0030/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /retry/i }),
    ).not.toBeInTheDocument();
    failing.unmount();

    // Empty app: no transactions at all.
    dataset = [];
    renderList();
    expect(await screen.findByText('No transactions yet')).toBeInTheDocument();
  });

  // AC-6
  it('refreshes in place on transactions-changed and resync, keeping the sort, page and page size', async () => {
    navigation.search = new URLSearchParams({
      sortBy: 'Amount',
      sortDirection: 'Desc',
      page: '2',
      pageSize: '5',
    });
    const byAmountDesc = [...dataset].sort((a, b) => b.amount - a.amount);
    const pageTwo = byAmountDesc.slice(5, 10);
    const topOfPageOne = byAmountDesc[0];
    const imported = pageTwo.filter((item) => item.status === 'Imported');
    expect(imported).toHaveLength(3);
    const [changedByImport, changedByResync] = imported;

    renderList();

    const table = await screen.findByRole('table');
    await waitFor(() =>
      expect(rowFor(table, changedByImport.reference)).toBeInTheDocument(),
    );
    for (const item of pageTwo) {
      expect(rowFor(table, item.reference)).toBeInTheDocument();
    }
    expect(
      within(table).queryByRole('row', {
        name: new RegExp(topOfPageOne.reference),
      }),
    ).not.toBeInTheDocument();
    expect(
      within(rowFor(table, changedByImport.reference)).getByText('Imported'),
    ).toBeInTheDocument();

    const [connection] = FakeEventSource.connections;
    expect(connection).toBeDefined();

    // transactions-changed: the back-end now has the row approved.
    dataset = dataset.map((item) =>
      item.id === changedByImport.id ? { ...item, status: 'Approved' } : item,
    );
    act(() =>
      connection.emit('transactions-changed', {
        fileId: changedByImport.file.id,
      }),
    );
    await waitFor(() =>
      expect(
        within(rowFor(table, changedByImport.reference)).getByText('Approved'),
      ).toBeInTheDocument(),
    );

    // resync: the back-end now has another row rejected.
    dataset = dataset.map((item) =>
      item.id === changedByResync.id ? { ...item, status: 'Rejected' } : item,
    );
    act(() => connection.emit('resync', {}));
    await waitFor(() =>
      expect(
        within(rowFor(table, changedByResync.reference)).getByText('Rejected'),
      ).toBeInTheDocument(),
    );

    // Still the same view: page 2 of 5, by amount, high to low.
    for (const item of pageTwo) {
      expect(rowFor(table, item.reference)).toBeInTheDocument();
    }
    expect(
      within(table).queryByRole('row', {
        name: new RegExp(topOfPageOne.reference),
      }),
    ).not.toBeInTheDocument();
  });

  // AC-3, AC-4
  it('offers a way back from a page past the end of the list', async () => {
    const user = userEvent.setup();
    expect(dataset).toHaveLength(30);
    // An old link to page 9 of 5 per page, when there are now 6 pages.
    navigation.search = new URLSearchParams({ page: '9', pageSize: '5' });

    renderList();

    expect(
      await screen.findByText('There are no transactions on this page.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No transactions yet')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Go to last page' }));
    const urls = navigation.push.mock.calls.map((call) => String(call[0]));
    expect(urls).toContainEqual(
      expect.stringMatching(
        /^\/transactions(?=.*[?&]page=6(&|$))(?=.*[?&]pageSize=5(&|$))/,
      ),
    );
  });

  // AC-2, AC-4
  it('keeps the previous rows while a new view loads, marked as updating', async () => {
    const byDateDesc = servePage(undefined).items;
    const byAmountAsc = servePage({
      sortBy: 'Amount',
      sortDirection: 'Asc',
    }).items;
    expect(byAmountAsc[0].reference).not.toBe(byDateDesc[0].reference);

    const view = renderList();
    const table = await screen.findByRole('table');
    await waitFor(() =>
      expect(rowFor(table, byDateDesc[0].reference)).toBeInTheDocument(),
    );
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
    expect(table.closest('[aria-busy="true"]')).toBeNull();

    // The person sorts by amount; the new page has not answered yet.
    let answer: (page: TransactionPage) => void = () => undefined;
    mockGet.mockImplementationOnce(
      () =>
        new Promise<TransactionPage>((resolve) => {
          answer = resolve;
        }),
    );
    navigation.search = new URLSearchParams({ sortBy: 'Amount' });
    view.rerender(
      <ToastProvider>
        <EventsProvider>
          <TransactionsList />
        </EventsProvider>
        <ToastContainer />
      </ToastProvider>,
    );

    expect(await screen.findByRole('status')).toHaveTextContent('Updating…');
    expect(rowFor(table, byDateDesc[0].reference)).toBeInTheDocument();
    expect(table.closest('[aria-busy="true"]')).not.toBeNull();

    await act(async () => {
      answer(servePage({ sortBy: 'Amount', sortDirection: 'Asc' }));
    });
    const sorted = screen.getByRole('table');
    expect(rowFor(sorted, byAmountAsc[0].reference)).toBeInTheDocument();
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
    expect(sorted.closest('[aria-busy="true"]')).toBeNull();
  });

  // AC-4, AC-6
  it('keeps the loaded rows with a small problem and Retry when a live refresh fails', async () => {
    const user = userEvent.setup();
    const [first] = servePage(undefined).items;

    renderList();
    const table = await screen.findByRole('table');
    await waitFor(() =>
      expect(rowFor(table, first.reference)).toBeInTheDocument(),
    );
    const [connection] = FakeEventSource.connections;

    // The refresh after a live update fails: the rows stay, with a small problem.
    mockGet.mockRejectedValueOnce({
      message: 'Something went wrong',
      statusCode: 500,
    });
    act(() =>
      connection.emit('transactions-changed', { fileId: first.file.id }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't refresh — showing earlier data",
    );
    expect(rowFor(table, first.reference)).toBeInTheDocument();
    expect(
      screen.queryByText('Transactions could not be loaded'),
    ).not.toBeInTheDocument();

    // Retry loads again in place, showing the back-end's latest rows.
    dataset = dataset.map((item) =>
      item.id === first.id ? { ...item, status: 'Approved' } : item,
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(
        within(rowFor(table, first.reference)).getByText('Approved'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
