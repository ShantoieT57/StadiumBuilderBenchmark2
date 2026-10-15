/**
 * Story Metadata:
 * - Route: /dashboard/files/[fileId]
 * - Target File: app-frontend/src/app/(authenticated)/dashboard/files/[fileId]/page.tsx
 * - Page Action: modify_existing
 *
 * Tests for Epic file-dashboard-and-details, Story 5: failed, in-progress and
 * cancelled files, live updates and downloading the original. Vitest covers AC-2..AC-6
 * (AC-1, the browser download itself, is Playwright).
 *
 * Render scope: through the page module, as Story 4 builds it (in parallel). The
 * signed-in pages are server components whose `RouteGuard` (async, server-only session
 * check) jsdom cannot render, so each test calls the page's default export, checks it
 * wraps its content in `<RouteGuard route="/dashboard">`, and renders that content
 * inside the providers the real layouts mount (ToastProvider + ToastContainer +
 * EventsProvider). Implementation contract these tests assume:
 * - The page default export takes Next's `{ params: Promise<{ fileId }> }` (sync or
 *   async) and returns `<RouteGuard route="/dashboard">` as its OUTERMOST element,
 *   whose children are the client content (Story 4 suggests `FileDetailsView` in
 *   `@/components/files/FileDetailsView`, props `{ fileId: string }`; no component
 *   name or prop is assumed here).
 * - The content loads the file with `getFile(id)` from `@/lib/api/endpoints`
 *   (-> `get('/files/<id>')` on the API client).
 * - Download: a button named "Download original", shown only when `canDownload` is
 *   true. It requests `/files/<id>/content` through the API client - either `get` or
 *   `apiClient(..., { isBinaryResponse: true })`; both are mocked here and served by
 *   the same in-test router, so either works. The Blob is saved via
 *   `URL.createObjectURL` (stubbed here; jsdom lacks it).
 * - Download problems are raised through `useToast()` as an `error` toast (a
 *   `role="alert"` inside the "Notifications" region, with a "Dismiss message"
 *   button) carrying the error's message; a 410 shows exactly
 *   "The original file is no longer available because the file was cancelled."
 * - Failed: a "Why it failed" panel with `failureReason` verbatim; no Retry button.
 * - Not available yet (`areTransactionsAvailable` false): text containing
 *   "transactions are not available yet", and no link into `/transactions`.
 *   When available, the counts are links whose href holds `fileId=<id>` and
 *   `status=Imported|Approved|Rejected` (Story 4).
 * - Cancelled: "Cancelled on <yyyy-MM-dd HH:mm local> by <name>" (" by <name>" omitted
 *   when `cancelledBy` is null), a note that the original was discarded, no download.
 * - Live: subscribes through `useEvents()` to `file-changed` (refetch when `fileId`
 *   matches the open file) and `resync`, and refetches in place (no loading state).
 *
 * Data-contract: the API client is mocked; the real proxy -> back-end chain is
 * verified by the Playwright spec and the manual checklist.
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Will fail until implemented (TDD red)
import FileDetailsPage from '@/app/(authenticated)/dashboard/files/[fileId]/page';
import { RouteGuard } from '@/components/shell/RouteGuard';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { EventsProvider } from '@/contexts/EventsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { apiClient, get } from '@/lib/api/client';
// Project-wide mock data shared with the Playwright layer (never re-defined here).
import {
  DASHBOARD_FILE_IDS,
  FILE_CONTENT_DISCARDED_MESSAGE,
  createFileDetails,
  fileContentFor,
  seededFileDetails,
} from '@/mocks/data/files';
import { userInfoFor } from '@/mocks/data/identity';
import type { FileDetails } from '@/types/api-generated';

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
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

const mockGet = get as ReturnType<typeof vi.fn>;
const mockApiClient = apiClient as ReturnType<typeof vi.fn>;

/** The 410 wording the story pins for a download of a discarded original. */
const DISCARDED_DOWNLOAD_MESSAGE =
  'The original file is no longer available because the file was cancelled.';

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

/** Next page props, loose enough for the page's signature. */
type PageModule = (props: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string>>;
}) => ReactNode | Promise<ReactNode>;

/**
 * Calls the details page's default export, checks it is guarded by
 * `<RouteGuard route="/dashboard">`, and renders the guarded content inside the
 * providers the real root and signed-in layouts mount.
 */
async function renderDetailsPage(
  fileId: string,
): Promise<{ unmount: () => void }> {
  const element = await (FileDetailsPage as unknown as PageModule)({
    params: Promise.resolve({ fileId }),
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
  expect(guarded.props.route).toBe('/dashboard');
  return render(
    <ToastProvider>
      <EventsProvider>{guarded.props.children}</EventsProvider>
      <ToastContainer />
    </ToastProvider>,
  );
}

/** The seeded details of `key` (fresh copy). */
function seeded(key: keyof typeof DASHBOARD_FILE_IDS): FileDetails {
  const details = seededFileDetails(DASHBOARD_FILE_IDS[key]);
  if (!details) throw new Error(`No seeded file ${key}`);
  return details;
}

/** `yyyy-MM-dd HH:mm` in the test machine's local time (the app shows local times). */
function localMinutes(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** What the in-test back-end answers for the original file of the open details. */
type ContentAnswer = 'ok' | { statusCode: number; message: string };

/** In-test back-end state, read on every request. */
let served: FileDetails;
let contentAnswer: ContentAnswer = 'ok';

/** One router behind both mocked client entry points (`get` and `apiClient`). */
function route(endpoint: unknown): Promise<unknown> {
  const url = String(endpoint);
  const id = encodeURIComponent(served.id);
  if (url === `/files/${id}/content`) {
    if (contentAnswer === 'ok') {
      return Promise.resolve(
        new Blob([fileContentFor(served)], { type: 'text/csv' }),
      );
    }
    return Promise.reject({
      message: contentAnswer.message,
      statusCode: contentAnswer.statusCode,
      details: [contentAnswer.message],
      endpoint: url,
    });
  }
  if (url === `/files/${id}`) {
    return Promise.resolve(served);
  }
  if (url === '/auth/me') {
    return Promise.resolve(userInfoFor('Importer'));
  }
  return Promise.reject({ message: 'Not found', statusCode: 404 });
}

function serve(details: FileDetails): void {
  served = details;
}

/** Links that open the Transactions list (the file's count links). */
function transactionLinks(): HTMLElement[] {
  return screen
    .queryAllByRole('link')
    .filter((link) =>
      (link.getAttribute('href') ?? '').startsWith('/transactions'),
    );
}

/** The count link for `status` of the open file. */
function countLink(fileId: string, status: string): HTMLElement | undefined {
  return transactionLinks().find((link) => {
    const href = link.getAttribute('href') ?? '';
    const query = new URLSearchParams(href.split('?')[1] ?? '');
    return query.get('fileId') === fileId && query.get('status') === status;
  });
}

describe('Epic file-dashboard-and-details, Story 5: file states and download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.connections = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    // jsdom has no object URLs; the download saves the Blob through one.
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:mock-download'),
      revokeObjectURL: vi.fn(),
    });
    contentAnswer = 'ok';
    serve(seeded('aprilBatch1'));
    mockGet.mockImplementation((endpoint: unknown) => route(endpoint));
    mockApiClient.mockImplementation((endpoint: unknown) => route(endpoint));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // AC-2
  it('shows a failed download’s actual problem until dismissed, and explains a 410 as the original discarded on cancel', async () => {
    const user = userEvent.setup();
    const file = seeded('aprilBatch1');
    serve(file);
    await renderDetailsPage(file.id);

    // A failed download shows the actual problem, and it stays until dismissed.
    contentAnswer = {
      statusCode: 500,
      message: 'Disk read failed on the server',
    };
    await user.click(
      await screen.findByRole('button', { name: /download original/i }),
    );
    const notifications = await screen.findByRole('region', {
      name: /notifications/i,
    });
    const problem = await within(notifications).findByRole('alert');
    expect(problem).toHaveTextContent('Disk read failed on the server');
    await user.click(
      within(problem).getByRole('button', { name: /dismiss message/i }),
    );
    expect(
      screen.queryByText('Disk read failed on the server'),
    ).not.toBeInTheDocument();

    // A 410: the original was discarded when the file was cancelled.
    contentAnswer = {
      statusCode: 410,
      message: FILE_CONTENT_DISCARDED_MESSAGE,
    };
    await user.click(
      screen.getByRole('button', { name: /download original/i }),
    );
    const discarded = await within(
      await screen.findByRole('region', { name: /notifications/i }),
    ).findByRole('alert');
    expect(discarded).toHaveTextContent(DISCARDED_DOWNLOAD_MESSAGE);
    expect(
      within(discarded).getByRole('button', { name: /dismiss message/i }),
    ).toBeInTheDocument();
  });

  // AC-3
  it('shows a cancelled file as cancelled with when and by whom, and offers no download', async () => {
    const byPerson = seeded('cancelledCompleted');
    serve(byPerson);
    const first = await renderDetailsPage(byPerson.id);

    expect(
      await screen.findByText(
        new RegExp(
          `cancelled on ${localMinutes('2026-04-22T15:30:00+02:00')} by File Importer`,
          'i',
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/original .*discarded/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /download original/i }),
    ).not.toBeInTheDocument();
    first.unmount();

    // No name recorded: the "by" part is left out.
    const noName = seeded('cancelledFailed');
    serve(noName);
    await renderDetailsPage(noName.id);

    expect(
      await screen.findByText(
        new RegExp(
          `cancelled on ${localMinutes('2026-04-25T13:20:00+02:00')}`,
          'i',
        ),
      ),
    ).not.toHaveTextContent(/ by /i);
    expect(
      screen.queryByRole('button', { name: /download original/i }),
    ).not.toBeInTheDocument();
  });

  // AC-4
  it('shows why a Failed file failed, verbatim, and offers no retry', async () => {
    const duplicate = seeded('duplicate');
    serve(duplicate);
    const first = await renderDetailsPage(duplicate.id);

    expect(await screen.findByText(/why it failed/i)).toBeInTheDocument();
    expect(
      screen.getByText('File is a duplicate of another file april-batch-1.csv'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /retry/i }),
    ).not.toBeInTheDocument();
    first.unmount();

    const invalidRows = seeded('invalidRows');
    serve(invalidRows);
    await renderDetailsPage(invalidRows.id);

    expect(await screen.findByText(/why it failed/i)).toBeInTheDocument();
    expect(screen.getByText('File has 2 invalid rows')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /retry/i }),
    ).not.toBeInTheDocument();
  });

  // AC-5
  it('says an Uploaded or Processing file’s transactions are not available yet, with no count links', async () => {
    for (const key of ['uploaded', 'processing'] as const) {
      const file = seeded(key);
      serve(file);
      const view = await renderDetailsPage(file.id);

      expect(
        await screen.findByText(/transactions are not available yet/i),
      ).toBeInTheDocument();
      expect(transactionLinks()).toEqual([]);
      view.unmount();
    }
  });

  // AC-6
  it('refreshes the open file in place when a file-changed update for it, or a resync, arrives', async () => {
    const processing = seeded('processing');
    serve(processing);
    await renderDetailsPage(processing.id);
    expect(
      await screen.findByText(/transactions are not available yet/i),
    ).toBeInTheDocument();

    // file-changed for the open file: Processing -> Completed, counts become links.
    serve(
      createFileDetails({
        ...processing,
        status: 'Completed',
        lastProcessedAt: '2026-05-04T07:52:00+02:00',
        loadedCount: 25,
        skippedExistingCount: 0,
        ignoredEmptyReferenceCount: 0,
        transactions: { imported: 25, approved: 0, rejected: 0 },
        areTransactionsAvailable: undefined,
      }),
    );
    emitLive('file-changed', {
      fileId: processing.id,
      status: 'Completed',
      isCancelled: false,
    });
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    await vi.waitFor(() => {
      expect(countLink(processing.id, 'Imported')).toBeDefined();
    });
    expect(
      screen.queryByText(/transactions are not available yet/i),
    ).not.toBeInTheDocument();

    // resync: the file was cancelled meanwhile; the details follow without a reload.
    serve(
      createFileDetails({
        ...served,
        isCancelled: true,
        cancelledAt: '2026-05-04T08:10:00+02:00',
        cancelledBy: 'File Importer',
        canDownload: false,
      }),
    );
    emitLive('resync', {});
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    expect(
      await screen.findByText(
        new RegExp(
          `cancelled on ${localMinutes('2026-05-04T08:10:00+02:00')} by File Importer`,
          'i',
        ),
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /download original/i }),
    ).not.toBeInTheDocument();
  });
});
