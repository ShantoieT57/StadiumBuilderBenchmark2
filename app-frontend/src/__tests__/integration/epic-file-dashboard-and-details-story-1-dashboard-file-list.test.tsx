/**
 * Story Metadata:
 * - Route: /dashboard
 * - Target File: app-frontend/src/app/(authenticated)/dashboard/page.tsx
 *   (the page stays a server component wrapped in `RouteGuard route="/dashboard"`,
 *   reads the role with `requireSession()` and renders the client list
 *   `@/components/files/FilesList` with `role={user.role}`)
 * - Page Action: modify_existing
 *
 * Tests for Epic file-dashboard-and-details, Story 1: Dashboard file list with
 * sorting, paging and phone layout. Vitest covers AC-1, AC-4 and AC-6
 * (AC-2, AC-3, AC-5 are Playwright).
 *
 * Contracts these tests pin (the developer implements to them):
 * - `@/components/files/FilesList` exports `FilesList`, a client component with one
 *   required prop `role: UserRole` ('Importer' | 'Approver'). It reads the list state
 *   from `useSearchParams()` (`sortBy`, `sortDirection` as `Asc`|`Desc`, `page`,
 *   `pageSize`, `status`, `fileName`, `processedFrom`, `processedTo`, `visibility`;
 *   defaults LastProcessedAt / Desc / 1 / 20 / Active) and loads it with
 *   `getFiles(...)` from `@/lib/api/endpoints`, passing those values as the query
 *   with the API's names (defaults may be omitted).
 * - The desktop layout is a `<table>` with one row per file. The phone layout
 *   (compact `<li>` rows) may also be in the DOM, toggled by CSS; these tests scope
 *   to the table.
 * - Each table row: the file name as a link to `/dashboard/files/<id>`; the last
 *   processed time in browser local time `yyyy-MM-dd HH:mm` (or "Not processed yet");
 *   the row count (or "Not counted yet"); the status in words (Uploaded / Processing /
 *   Completed / Failed); the Imported count as a bare number; and, for a cancelled
 *   file, an extra "Cancelled" word badge.
 * - States: a loading state with the text "Loading files" while the first load is
 *   pending; a failed load shows an inline problem with a "Retry" button that loads
 *   again; an unfiltered empty list (totalCount 0) shows "No files yet", plus an
 *   "Upload" link to `/upload` for an Importer only.
 * - Live refresh: subscribes through `useEvents()` (from `@/contexts/EventsContext`)
 *   to `file-changed`, `transactions-changed` and `resync`, and refetches with the
 *   current URL params (no second EventSource).
 *
 * jsdom has no EventSource, so the browser API is replaced by an in-test fake and the
 * real EventsProvider is used. Only `@/lib/api/client` and `next/navigation` are
 * mocked; the mocked `get` serves the shared seeded file dataset, honouring the
 * visibility, sort and paging params.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Target module - will fail until implemented (TDD red).
import { FilesList } from '@/components/files/FilesList';
import { EventsProvider } from '@/contexts/EventsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { get } from '@/lib/api/client';
import {
  DASHBOARD_FILE_IDS,
  filePageOf,
  seedDashboardFiles,
} from '@/mocks/data/files';
import type {
  FileListItem,
  FilePage,
  FileSortColumn,
  UserRole,
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

/** Sort key of a file; nulls are returned as null and always sort last. */
function sortValue(
  item: FileListItem,
  column: FileSortColumn,
): string | number | null {
  switch (column) {
    case 'FileName':
      return item.fileName.toLowerCase();
    case 'RowCount':
      return item.rowCount;
    case 'Status':
      return item.status;
    case 'ImportedCount':
      return item.importedCount;
    default:
      return item.lastProcessedAt === null
        ? null
        : Date.parse(item.lastProcessedAt);
  }
}

/** In-test back-end: serves `dataset` filtered by visibility, sorted and paged. */
let dataset: FileListItem[] = [];

function servePage(params: unknown): FilePage {
  const query = (params ?? {}) as Record<string, unknown>;
  const visibility = query.visibility ?? 'Active';
  const sortBy =
    (query.sortBy as FileSortColumn | undefined) ?? 'LastProcessedAt';
  const direction =
    query.sortDirection ?? (sortBy === 'LastProcessedAt' ? 'Desc' : 'Asc');
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);
  const visible = dataset.filter((file) =>
    visibility === 'Both'
      ? true
      : visibility === 'Cancelled'
        ? file.isCancelled
        : !file.isCancelled,
  );
  const sorted = [...visible].sort((a, b) => {
    const left = sortValue(a, sortBy);
    const right = sortValue(b, sortBy);
    // The API puts not-yet-processed files first when newest-first (they are the
    // newest uploads), and null counts last otherwise.
    if (left === null || right === null) {
      if (left === right) return 0;
      if (sortBy === 'LastProcessedAt') {
        const nullFirst = direction === 'Desc' ? -1 : 1;
        return left === null ? nullFirst : -nullFirst;
      }
      return left === null ? 1 : -1;
    }
    const order = left < right ? -1 : left > right ? 1 : 0;
    return direction === 'Desc' ? -order : order;
  });
  return filePageOf(sorted, { page, pageSize });
}

function serveFromDataset(): void {
  mockGet.mockImplementation(async (endpoint: unknown, params?: unknown) => {
    if (endpoint !== '/files') {
      throw { message: `Unexpected call ${String(endpoint)}`, statusCode: 404 };
    }
    return servePage(params);
  });
}

function listTree(role: UserRole) {
  return (
    <ToastProvider>
      <EventsProvider>
        <FilesList role={role} />
      </EventsProvider>
      <ToastContainer />
    </ToastProvider>
  );
}

function renderList(role: UserRole = 'Approver') {
  return render(listTree(role));
}

/** The table row of the file named `fileName`, found through its details link. */
function rowFor(table: HTMLElement, fileName: string): HTMLElement {
  const link = within(table).getByRole('link', { name: fileName });
  const row = link.closest('tr');
  if (!row) throw new Error(`No table row holds the link ${fileName}`);
  return row;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** An offset ISO time as the browser shows it: local `yyyy-MM-dd HH:mm`. */
function localDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

describe('Epic file-dashboard-and-details, Story 1: Dashboard file list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.search = new URLSearchParams();
    FakeEventSource.connections = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    dataset = seedDashboardFiles();
    serveFromDataset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // AC-1
  it('shows each file with its name, last processed time, rows, status in words and Imported count, and marks a cancelled file "Cancelled"', async () => {
    // Active and cancelled files together, so a cancelled row is in view.
    navigation.search = new URLSearchParams({ visibility: 'Both' });

    renderList();

    const table = await screen.findByRole('table');
    await waitFor(() =>
      expect(rowFor(table, 'april-batch-1.csv')).toBeInTheDocument(),
    );

    // A processed, completed file with transactions still Imported.
    const completedLink = within(table).getByRole('link', {
      name: 'april-batch-1.csv',
    });
    expect(completedLink).toHaveAttribute(
      'href',
      `/dashboard/files/${DASHBOARD_FILE_IDS.aprilBatch1}`,
    );
    const completed = within(rowFor(table, 'april-batch-1.csv'));
    expect(
      completed.getByText(localDateTime('2026-04-30T18:05:00+02:00')),
    ).toBeInTheDocument();
    expect(completed.getByText('18')).toBeInTheDocument();
    expect(completed.getByText('Completed')).toBeInTheDocument();
    expect(completed.getByText('9')).toBeInTheDocument();
    expect(completed.queryByText('Cancelled')).not.toBeInTheDocument();

    // Not processed and not read yet.
    const uploaded = within(rowFor(table, 'may-payroll.csv'));
    expect(uploaded.getByText('Not processed yet')).toBeInTheDocument();
    expect(uploaded.getByText('Not counted yet')).toBeInTheDocument();
    expect(uploaded.getByText('Uploaded')).toBeInTheDocument();
    expect(uploaded.getByText('0')).toBeInTheDocument();

    // Read but still being processed.
    const processing = within(rowFor(table, 'may-suppliers.csv'));
    expect(processing.getByText('Not processed yet')).toBeInTheDocument();
    expect(processing.getByText('25')).toBeInTheDocument();
    expect(processing.getByText('Processing')).toBeInTheDocument();

    // Failed.
    const failed = within(rowFor(table, 'april-invalid-rows.csv'));
    expect(
      failed.getByText(localDateTime('2026-05-01T11:40:00+02:00')),
    ).toBeInTheDocument();
    expect(failed.getByText('15')).toBeInTheDocument();
    expect(failed.getByText('Failed')).toBeInTheDocument();

    // Cancelled: its own status in words plus "Cancelled".
    const cancelled = within(rowFor(table, 'feb-legacy-import.csv'));
    expect(
      cancelled.getByText(localDateTime('2026-04-20T10:02:00+02:00')),
    ).toBeInTheDocument();
    expect(cancelled.getByText('10')).toBeInTheDocument();
    expect(cancelled.getByText('Completed')).toBeInTheDocument();
    expect(cancelled.getByText('Cancelled')).toBeInTheDocument();
  });

  // AC-4
  it('shows a loading state, a problem with Retry when the load fails, and "No files yet" with an Upload link for an Importer only', async () => {
    const user = userEvent.setup();

    // Loading: the first load has not answered yet.
    let answer: (page: FilePage) => void = () => undefined;
    mockGet.mockImplementationOnce(
      () =>
        new Promise<FilePage>((resolve) => {
          answer = resolve;
        }),
    );
    const loading = renderList();
    expect(await screen.findByText(/loading files/i)).toBeInTheDocument();
    await act(async () => {
      answer(servePage(undefined));
    });
    expect(
      within(await screen.findByRole('table')).getByRole('link', {
        name: 'may-payroll.csv',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/loading files/i)).not.toBeInTheDocument();
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
      within(await screen.findByRole('table')).getByRole('link', {
        name: 'may-payroll.csv',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /retry/i }),
    ).not.toBeInTheDocument();
    failing.unmount();

    // No files at all - Importer: "No files yet" with a link to upload one.
    dataset = [];
    const importer = renderList('Importer');
    expect(await screen.findByText('No files yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /upload/i })).toHaveAttribute(
      'href',
      '/upload',
    );
    importer.unmount();

    // No files at all - Approver: "No files yet" and no upload link.
    renderList('Approver');
    expect(await screen.findByText('No files yet')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /upload/i }),
    ).not.toBeInTheDocument();
  });

  // AC-6
  it('refreshes in place on file-changed, transactions-changed and resync, keeping the sort, page and page size', async () => {
    navigation.search = new URLSearchParams({
      sortBy: 'FileName',
      sortDirection: 'Asc',
      page: '2',
      pageSize: '5',
    });
    // Page 2 of 5 by name, A to Z (case-insensitive), of the 9 active files.
    const pageTwo = [
      'march-statement-rerun.csv',
      'may-payroll.csv',
      'may-suppliers.csv',
      'Q1-Adjustments.csv',
    ];
    const onPageOne = 'april-batch-1.csv';

    renderList();

    const table = await screen.findByRole('table');
    await waitFor(() =>
      expect(rowFor(table, 'may-payroll.csv')).toBeInTheDocument(),
    );
    for (const name of pageTwo) {
      expect(rowFor(table, name)).toBeInTheDocument();
    }
    expect(
      within(table).queryByRole('link', { name: onPageOne }),
    ).not.toBeInTheDocument();
    expect(
      within(rowFor(table, 'may-payroll.csv')).getByText('Uploaded'),
    ).toBeInTheDocument();

    const [connection] = FakeEventSource.connections;
    expect(connection).toBeDefined();

    // file-changed: the uploaded file has started processing and has been read.
    dataset = dataset.map((file) =>
      file.id === DASHBOARD_FILE_IDS.uploaded
        ? { ...file, status: 'Processing', rowCount: 30 }
        : file,
    );
    act(() =>
      connection.emit('file-changed', {
        fileId: DASHBOARD_FILE_IDS.uploaded,
        status: 'Processing',
        isCancelled: false,
      }),
    );
    await waitFor(() =>
      expect(
        within(rowFor(table, 'may-payroll.csv')).getByText('Processing'),
      ).toBeInTheDocument(),
    );
    expect(
      within(rowFor(table, 'may-payroll.csv')).getByText('30'),
    ).toBeInTheDocument();

    // transactions-changed: the processing file finished with 25 Imported.
    dataset = dataset.map((file) =>
      file.id === DASHBOARD_FILE_IDS.processing
        ? {
            ...file,
            status: 'Completed',
            lastProcessedAt: '2026-05-04T07:52:00+02:00',
            importedCount: 25,
          }
        : file,
    );
    act(() =>
      connection.emit('transactions-changed', {
        fileId: DASHBOARD_FILE_IDS.processing,
      }),
    );
    await waitFor(() =>
      expect(
        within(rowFor(table, 'may-suppliers.csv')).getByText('Completed'),
      ).toBeInTheDocument(),
    );
    expect(
      within(rowFor(table, 'may-suppliers.csv')).getByText(
        localDateTime('2026-05-04T07:52:00+02:00'),
      ),
    ).toBeInTheDocument();

    // resync: another file now has transactions still Imported.
    dataset = dataset.map((file) =>
      file.id === DASHBOARD_FILE_IDS.mixedCaseInvalid
        ? {
            ...file,
            status: 'Completed',
            failureKind: null,
            failureReason: null,
            importedCount: 7,
          }
        : file,
    );
    act(() => connection.emit('resync', {}));
    await waitFor(() =>
      expect(
        within(rowFor(table, 'Q1-Adjustments.csv')).getByText('7'),
      ).toBeInTheDocument(),
    );

    // Still the same view: page 2 of 5, by name, A to Z - and still one connection.
    for (const name of pageTwo) {
      expect(rowFor(table, name)).toBeInTheDocument();
    }
    expect(
      within(table).queryByRole('link', { name: onPageOne }),
    ).not.toBeInTheDocument();
    expect(FakeEventSource.connections).toHaveLength(1);
  });
});
