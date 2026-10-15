/**
 * Story Metadata:
 * - Route: /dashboard
 * - Target File: app-frontend/src/app/(authenticated)/dashboard/page.tsx
 * - Page Action: modify_existing
 *
 * Tests for Epic file-correction-and-cancel, Story 2: Dashboard correction shortcut
 * and who can correct. Vitest covers AC-2 and AC-5 (AC-1, AC-3, AC-4 are Playwright).
 * The two untagged technical checks ride along: the shortcut's accessible name holds
 * the file name (AC-2 test), and a failed background refresh keeps the form with the
 * "Couldn't refresh" notice (AC-5 test).
 *
 * Render scope: through the page modules. Signed-in pages are server components whose
 * outermost element is `<RouteGuard>` (async, server-only), which jsdom cannot render,
 * so each test calls the page's default export, checks the outermost element is
 * `RouteGuard`, and renders its children inside the providers the real layouts mount
 * (ToastProvider + ToastContainer + EventsProvider). This keeps the client component
 * names free for the developer.
 *
 * Contracts these tests assume (the developer implements to them):
 * - `requireSession()` (`@/lib/auth/requireSession`, server-only) is the role source
 *   for pages. It is mocked here to return the seeded user of the role under test;
 *   `GET /auth/me` on the API client answers the same user, so a client-side role
 *   lookup also works.
 * - Dashboard (`app/(authenticated)/dashboard/page.tsx`, default export, no props):
 *   for an Importer only, each row with `status === 'Failed' && failureKind ===
 *   'InvalidRows' && !isCancelled` gets a link whose accessible name is exactly
 *   "Correct <file name>" (e.g. visible "Correct" + sr-only " <file name>") and href
 *   `/dashboard/files/<id>/corrections`, in BOTH the table (md+) and the compact `<li>`
 *   list (`aria-label="Files"`). A function prop cannot cross from the server page to
 *   the client `FilesList`, so the page needs a small client wrapper (or equivalent)
 *   that supplies `rowActions`; any name is fine. No other row, and no Approver, gets a
 *   link or button named "Correct..." (hidden, not disabled).
 * - File details (`app/(authenticated)/dashboard/files/[fileId]/page.tsx`, story 1):
 *   still wrapped in `RouteGuard`; for an Importer and a Failed + InvalidRows + not
 *   cancelled file it shows a link named "Correct invalid rows" to
 *   `/dashboard/files/<id>/corrections`; nothing for duplicates, other statuses,
 *   cancelled files or an Approver.
 * - Correction screen (`app/(authenticated)/dashboard/files/[fileId]/corrections/page.tsx`,
 *   story 1, Next props `{ params: Promise<{ fileId }> }`, outermost `RouteGuard` with
 *   any route value): loads `getFile` (`GET /files/<id>`) and `getInvalidRows`
 *   (`GET /files/<id>/invalid-rows`). Each invalid row is a `<section aria-labelledby>`
 *   (role region) named "Row <n>" holding labelled inputs ("Amount", ...); the count
 *   reads "<N> rows still need correcting" ("1 row still needs correcting" accepted).
 *   It subscribes via `useEvents()` to `file-changed` (this file) and `resync`, then
 *   refetches both: still waiting -> unsent edits are kept and the count refreshes; a
 *   409 from invalid-rows -> the form is replaced by a panel with "This file is not
 *   waiting for corrections." (the back-end message), the file's current status in
 *   words and a "View file details" link to `/dashboard/files/<id>`; a failed refresh
 *   keeps the form with `RefreshFailedNotice` ("Couldn't refresh...").
 *
 * Only the API client, `next/navigation` and the server-only `requireSession` are
 * mocked; jsdom has no EventSource, so an in-test fake is used under the real
 * EventsProvider. Mock data comes from the read-only shared modules.
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Target modules - the corrections page will fail until implemented (TDD red).
import DashboardPage from '@/app/(authenticated)/dashboard/page';
import FileDetailsPage from '@/app/(authenticated)/dashboard/files/[fileId]/page';
import CorrectionsPage from '@/app/(authenticated)/dashboard/files/[fileId]/corrections/page';
import { RouteGuard } from '@/components/shell/RouteGuard';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { EventsProvider } from '@/contexts/EventsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { apiClient, get, post } from '@/lib/api/client';
// Project-wide mock data shared with the Playwright layer (read-only here).
import { createDashboardSummary } from '@/mocks/data/dashboardSummary';
import {
  DASHBOARD_FILE_IDS,
  filePageOf,
  seedDashboardFileDetails,
  toFileListItem,
} from '@/mocks/data/files';
import { userInfoFor } from '@/mocks/data/identity';
import {
  NOT_WAITING_FOR_CORRECTIONS_MESSAGE,
  createRecheckResult,
  invalidRowListOf,
  invalidRowsFailureReason,
  seededFileRows,
  seededInvalidRows,
} from '@/mocks/data/invalidRows';
import type {
  FileDetails,
  InvalidRowList,
  UserRole,
} from '@/types/api-generated';

const session = vi.hoisted(() => ({ role: 'Importer' as UserRole }));

vi.mock('@/lib/auth/requireSession', async () => {
  const identity = await import('@/mocks/data/identity');
  return {
    requireSession: vi.fn(async () => identity.userInfoFor(session.role)),
  };
});

const navigation = vi.hoisted(() => ({
  search: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: navigation.push,
    replace: navigation.replace,
    refresh: navigation.refresh,
    back: navigation.back,
  }),
  usePathname: () => '/dashboard',
  useSearchParams: () => navigation.search,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  get: vi.fn(),
  post: vi.fn(),
  apiClient: vi.fn(),
}));

const mockGet = get as ReturnType<typeof vi.fn>;
const mockPost = post as ReturnType<typeof vi.fn>;
const mockApiClient = apiClient as ReturnType<typeof vi.fn>;

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

/** Sends a named server event on every open live connection. */
function emitLive(name: string, data: unknown): void {
  act(() => {
    FakeEventSource.connections
      .filter((connection) => connection.readyState !== FakeEventSource.CLOSED)
      .forEach((connection) => connection.emit(name, data));
  });
}

// ---------------------------------------------------------------------------
// In-test back-end (read on every request)
// ---------------------------------------------------------------------------

/** 409 answer for invalid-rows of a file that is not waiting for corrections. */
const NOT_WAITING = 'not-waiting' as const;

let detailsById = new Map<string, FileDetails>();
let invalidRowsById = new Map<string, InvalidRowList | typeof NOT_WAITING>();
/** When true, every file / invalid-rows read fails with a 500 (a failed refresh). */
let failReads = false;

function rejectWith(statusCode: number, message: string, endpoint: string) {
  return Promise.reject({
    message,
    statusCode,
    details: [message],
    endpoint,
    body: { message },
  });
}

function route(endpoint: unknown, params?: unknown): Promise<unknown> {
  const url = String(endpoint);
  if (url === '/auth/me') return Promise.resolve(userInfoFor(session.role));
  if (url === '/dashboard/summary') {
    return Promise.resolve(createDashboardSummary());
  }
  if (url === '/files') {
    const query = (params ?? {}) as Record<string, unknown>;
    const visibility = query.visibility ?? 'Active';
    const items = [...detailsById.values()]
      .map(toFileListItem)
      .filter((file) =>
        visibility === 'Both'
          ? true
          : visibility === 'Cancelled'
            ? file.isCancelled
            : !file.isCancelled,
      );
    return Promise.resolve(
      filePageOf(items, {
        page: Number(query.page ?? 1),
        pageSize: Number(query.pageSize ?? 20),
      }),
    );
  }
  const match = /^\/files\/([^/]+)(\/invalid-rows)?$/.exec(url);
  if (match) {
    if (failReads) return rejectWith(500, 'Something went wrong', url);
    const id = decodeURIComponent(match[1]);
    const details = detailsById.get(id);
    if (!details) return rejectWith(404, 'File not found', url);
    if (!match[2]) return Promise.resolve(details);
    const rows = invalidRowsById.get(id) ?? NOT_WAITING;
    if (rows === NOT_WAITING) {
      return rejectWith(409, NOT_WAITING_FOR_CORRECTIONS_MESSAGE, url);
    }
    return Promise.resolve(rows);
  }
  return rejectWith(404, 'Not found', url);
}

// ---------------------------------------------------------------------------
// Page rendering
// ---------------------------------------------------------------------------

/** Next page props, loose enough for each page's signature. */
type PageModule = (props: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string>>;
}) => ReactNode | Promise<ReactNode>;

/**
 * Calls a page's default export, checks its outermost element is `RouteGuard`, and
 * renders the guarded content inside the providers the real layouts mount.
 */
async function renderPage(
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
  const guarded = element as ReactElement<{ children: ReactNode }>;
  expect(guarded.type).toBe(RouteGuard);
  return render(
    <ToastProvider>
      <EventsProvider>{guarded.props.children}</EventsProvider>
      <ToastContainer />
    </ToastProvider>,
  );
}

function correctionsHref(id: string): string {
  return `/dashboard/files/${id}/corrections`;
}

/** The table row of the file named `fileName`, found through its name link. */
function rowFor(table: HTMLElement, fileName: string): HTMLElement {
  const link = within(table).getByRole('link', { name: fileName });
  const row = link.closest('tr');
  if (!row) throw new Error(`No table row holds the link ${fileName}`);
  return row;
}

/** Any link or button whose accessible name starts with "Correct". */
const CORRECT_NAME = /^correct\b/i;

/** Row 11's Amount field on the correction screen of file 06. */
async function row11Amount(): Promise<HTMLElement> {
  const row = await screen.findByRole('region', { name: /^row 11\b/i });
  return within(row).getByLabelText(/^amount/i);
}

describe('Epic file-correction-and-cancel, Story 2: correction shortcut and guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.role = 'Importer';
    navigation.search = new URLSearchParams();
    FakeEventSource.connections = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    failReads = false;
    detailsById = new Map(
      seedDashboardFileDetails().map((details) => [details.id, details]),
    );
    invalidRowsById = new Map<string, InvalidRowList | typeof NOT_WAITING>([
      [
        DASHBOARD_FILE_IDS.invalidRows,
        seededInvalidRows(DASHBOARD_FILE_IDS.invalidRows),
      ],
      [
        DASHBOARD_FILE_IDS.mixedCaseInvalid,
        seededInvalidRows(DASHBOARD_FILE_IDS.mixedCaseInvalid),
      ],
    ]);
    mockGet.mockImplementation((endpoint: unknown, params?: unknown) =>
      route(endpoint, params),
    );
    mockApiClient.mockImplementation((endpoint: unknown) => route(endpoint));
    mockPost.mockImplementation((endpoint: unknown) => route(endpoint));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // AC-2
  it('offers correction only to an Importer on files that failed because of invalid rows - never for duplicates, other statuses, cancelled files or an Approver', async () => {
    const ids = DASHBOARD_FILE_IDS;
    // Active and cancelled files together, so the cancelled invalid-rows file is in view.
    navigation.search = new URLSearchParams({ visibility: 'Both' });

    // Dashboard, Importer: the shortcut, named with the file, on waiting files only.
    const importerDashboard = await renderPage(DashboardPage);
    const table = await screen.findByRole('table');
    await waitFor(() =>
      expect(rowFor(table, 'april-invalid-rows.csv')).toBeInTheDocument(),
    );
    const tableShortcut = within(
      rowFor(table, 'april-invalid-rows.csv'),
    ).getByRole('link', { name: /^correct april-invalid-rows\.csv$/i });
    expect(tableShortcut).toHaveAttribute(
      'href',
      correctionsHref(ids.invalidRows),
    );
    const compactList = screen.getByRole('list', { name: 'Files' });
    expect(
      within(compactList).getByRole('link', {
        name: /^correct april-invalid-rows\.csv$/i,
      }),
    ).toHaveAttribute('href', correctionsHref(ids.invalidRows));

    for (const fileName of [
      'bank-export-copy.csv', // Failed as a duplicate
      'wrong-bank-format.csv', // Failed with invalid rows, but cancelled
      'april-batch-1.csv', // Completed
      'may-payroll.csv', // Uploaded
      'may-suppliers.csv', // Processing
    ]) {
      expect(
        within(rowFor(table, fileName)).queryByRole('link', {
          name: CORRECT_NAME,
        }),
      ).not.toBeInTheDocument();
    }
    // Across both layouts, every "Correct" link leads to one of the two waiting files.
    const shortcutTargets = new Set(
      screen
        .getAllByRole('link', { name: CORRECT_NAME })
        .map((link) => link.getAttribute('href')),
    );
    expect(shortcutTargets).toEqual(
      new Set([
        correctionsHref(ids.invalidRows),
        correctionsHref(ids.mixedCaseInvalid),
      ]),
    );
    importerDashboard.unmount();

    // Dashboard, Approver: no correction controls at all (hidden, not disabled).
    session.role = 'Approver';
    const approverDashboard = await renderPage(DashboardPage);
    const approverTable = await screen.findByRole('table');
    await waitFor(() =>
      expect(
        rowFor(approverTable, 'april-invalid-rows.csv'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryAllByRole('link', { name: CORRECT_NAME })).toEqual([]);
    expect(screen.queryAllByRole('button', { name: CORRECT_NAME })).toEqual([]);
    approverDashboard.unmount();

    // Details, Importer: "Correct invalid rows" only for the waiting file.
    session.role = 'Importer';
    const waiting = await renderPage(FileDetailsPage, {
      fileId: ids.invalidRows,
    });
    expect(
      await screen.findByRole('link', { name: /correct invalid rows/i }),
    ).toHaveAttribute('href', correctionsHref(ids.invalidRows));
    waiting.unmount();

    for (const [fileId, loadedText] of [
      [ids.duplicate, 'File is a duplicate of another file april-batch-1.csv'],
      [ids.cancelledFailed, 'File has 6 invalid rows'],
    ] as const) {
      const view = await renderPage(FileDetailsPage, { fileId });
      expect(await screen.findByText(loadedText)).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: /correct invalid rows/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /correct invalid rows/i }),
      ).not.toBeInTheDocument();
      view.unmount();
    }

    const processing = await renderPage(FileDetailsPage, {
      fileId: ids.processing,
    });
    expect(
      await screen.findByText(/transactions are not available yet/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /correct invalid rows/i }),
    ).not.toBeInTheDocument();
    processing.unmount();

    // Details, Approver: the waiting file offers no correction either.
    session.role = 'Approver';
    await renderPage(FileDetailsPage, { fileId: ids.invalidRows });
    expect(
      await screen.findByText('File has 2 invalid rows'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /correct invalid rows/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /correct invalid rows/i }),
    ).not.toBeInTheDocument();
  });

  // AC-5
  it('follows changes made elsewhere without a reload: keeps unsent edits while still waiting, keeps the form on a failed refresh, and switches to the not-waiting notice', async () => {
    const user = userEvent.setup();
    const fileId = DASHBOARD_FILE_IDS.invalidRows;
    await renderPage(CorrectionsPage, { fileId });

    // An edit not yet sent.
    const amount = await row11Amount();
    expect(amount).toHaveValue('-509.75');
    await user.clear(amount);
    await user.type(amount, '509.75');
    expect(await row11Amount()).toHaveValue('509.75');

    // Elsewhere, row 4 was fixed and checked: the file still waits, now for 1 row.
    const allRows = seededFileRows(fileId);
    const stillWaiting = invalidRowListOf(
      allRows.map((row) =>
        row.rowNumber === 4
          ? {
              ...row,
              transactionDate: '2026/04/04 08:04',
              accountNumber: '1001-2034-5567',
              reasons: [],
            }
          : row,
      ),
    );
    invalidRowsById.set(fileId, stillWaiting);
    const waitingFile = detailsById.get(fileId);
    if (!waitingFile) throw new Error('seeded file 06 is missing');
    detailsById.set(fileId, {
      ...waitingFile,
      failureReason: invalidRowsFailureReason(1),
    });
    emitLive('file-changed', { fileId, status: 'Failed', isCancelled: false });

    await waitFor(() =>
      expect(
        screen.queryByText(/\b2 rows still need correcting/i),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getAllByText(/\b1 rows? still needs? correcting/i)[0],
    ).toBeInTheDocument();
    expect(await row11Amount()).toHaveValue('509.75');

    // A background refresh that fails keeps the form and the edit, with a notice.
    failReads = true;
    emitLive('resync', {});
    expect(await screen.findByText(/couldn't refresh/i)).toBeInTheDocument();
    expect(await row11Amount()).toHaveValue('509.75');
    expect(
      screen.getByRole('button', { name: /check again/i }),
    ).toBeInTheDocument();
    failReads = false;

    // Elsewhere, the file was corrected and loaded: no longer waiting.
    detailsById.set(fileId, createRecheckResult().file);
    invalidRowsById.set(fileId, NOT_WAITING);
    emitLive('file-changed', {
      fileId,
      status: 'Completed',
      isCancelled: false,
    });

    const message = await screen.findByText(
      NOT_WAITING_FOR_CORRECTIONS_MESSAGE,
    );
    const detailsLink = screen.getByRole('link', {
      name: /view file details/i,
    });
    expect(detailsLink).toHaveAttribute('href', `/dashboard/files/${fileId}`);
    // The notice panel holds the message, the current status in words and the link.
    let notice: HTMLElement | null = message.parentElement;
    while (notice && !notice.contains(detailsLink)) {
      notice = notice.parentElement;
    }
    if (!notice)
      throw new Error('The not-waiting notice holds no details link');
    expect(within(notice).getAllByText(/completed/i)[0]).toBeVisible();
    // The form is gone.
    expect(
      screen.queryByRole('region', { name: /^row 11\b/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /check again/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /save changes/i }),
    ).not.toBeInTheDocument();
  });
});
