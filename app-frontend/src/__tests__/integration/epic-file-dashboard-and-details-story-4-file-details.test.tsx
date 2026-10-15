/**
 * Story Metadata:
 * - Route: /dashboard/files/[fileId]
 * - Target File: app-frontend/src/app/(authenticated)/dashboard/files/[fileId]/page.tsx
 * - Page Action: create_new
 *
 * Tests for Epic file-dashboard-and-details, Story 4: file details.
 *
 * Render scope: through the page module. The signed-in pages are server components
 * whose `RouteGuard` (async, server-only session check) jsdom cannot render, so each
 * test calls the page's default export, checks it wraps its content in
 * `<RouteGuard route="/dashboard">`, and renders that content inside the same
 * providers the real layouts mount (ToastProvider + EventsProvider). Implementation
 * contract these tests assume:
 * - The details page default export takes Next's `{ params: Promise<{ fileId }> }`
 *   (sync or async) and returns `<RouteGuard route="/dashboard">` as its OUTERMOST
 *   element, whose children are the client content (suggested: `FileDetailsView` in
 *   `@/components/files/FileDetailsView`, props `{ fileId: string }`; Story 5 extends
 *   the same view).
 * - The content loads the file with `getFile(id)` from `@/lib/api/endpoints`
 *   (-> `get('/files/<id>')` on the API client).
 * - The file name renders as a heading.
 * - The fully-reviewed message reads "This file is fully reviewed" and follows
 *   `isFullyReviewed` only (BR6) - never recomputed from the transaction counts.
 * - The processing history is a `<table>` whose accessible name is "Processing
 *   history" (caption or aria-label/labelledby). It has one header row, then one row
 *   per `processingHistory` entry, in the order returned, with exactly three cells:
 *   stage in words, Started, Finished. Times are local `yyyy-MM-dd HH:mm:ss`;
 *   a null `finishedAt` shows "In progress".
 * - States: while loading, visible text containing "Loading"; a failed load shows a
 *   `role="alert"` problem plus a "Retry" button that reloads in place; a 404 shows
 *   "File not found" together with a "Back to dashboard" link to /dashboard.
 *
 * Data-contract: the API client is mocked; the real proxy -> back-end chain is
 * verified during the manual checklist and the Playwright spec.
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Will fail until implemented (TDD red)
import FileDetailsPage from '@/app/(authenticated)/dashboard/files/[fileId]/page';
import { RouteGuard } from '@/components/shell/RouteGuard';
import { EventsProvider } from '@/contexts/EventsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { get } from '@/lib/api/client';
// Project-wide mock data shared with the Playwright layer (never re-defined here).
import {
  DASHBOARD_FILE_IDS,
  FILE_NOT_FOUND_MESSAGE,
  UNKNOWN_FILE_ID,
  seededFileDetails,
} from '@/mocks/data/files';
import { userInfoFor } from '@/mocks/data/identity';
import type { FileDetails } from '@/types/api-generated';

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
  usePathname: () => '/dashboard/files/7c1e2a40-0000-4000-8000-000000000001',
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

/** Next page props, loose enough for either page signature. */
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
    </ToastProvider>,
  );
}

/** The seeded details record for `id` (fails loudly if the dataset changes). */
function seeded(id: string): FileDetails {
  const details = seededFileDetails(id);
  if (!details) {
    throw new Error(`No seeded file with id ${id}`);
  }
  return details;
}

/** Serves the mocked API: the given details for its own id and the signed-in user. */
function serveApi(details: FileDetails) {
  mockGet.mockImplementation((url: unknown) => {
    if (url === `/files/${encodeURIComponent(details.id)}`) {
      return Promise.resolve(details);
    }
    if (url === '/auth/me') {
      return Promise.resolve(userInfoFor('Importer'));
    }
    return Promise.reject({ message: 'Not found', statusCode: 404 });
  });
}

/** An ISO instant as local `yyyy-MM-dd HH:mm:ss` (the time zone the test runs in). */
function localSeconds(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

describe('Epic file-dashboard-and-details, Story 4: file details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // AC-3
  it('says a file is fully reviewed only when the back-end marks it so', async () => {
    const fullyReviewedMessage = /this file is fully reviewed/i;

    // Fully reviewed: march-statement-rerun.csv (no transactions still Imported).
    const reviewed = seeded(DASHBOARD_FILE_IDS.allSkipped);
    serveApi(reviewed);
    const first = await renderDetailsPage(reviewed.id);
    await screen.findByRole('heading', { name: 'march-statement-rerun.csv' });
    expect(screen.getByText(fullyReviewedMessage)).toBeInTheDocument();
    first.unmount();

    // Still has Imported transactions: april-batch-1.csv (9 Imported).
    const pending = seeded(DASHBOARD_FILE_IDS.aprilBatch1);
    serveApi(pending);
    const second = await renderDetailsPage(pending.id);
    await screen.findByRole('heading', { name: 'april-batch-1.csv' });
    expect(screen.queryByText(fullyReviewedMessage)).not.toBeInTheDocument();
    second.unmount();

    // Never recomputed (BR6): feb-legacy-import.csv has 0 Imported but is
    // cancelled, so the back-end says it is NOT fully reviewed.
    const cancelled = seeded(DASHBOARD_FILE_IDS.cancelledCompleted);
    expect(cancelled.isFullyReviewed).toBe(false);
    serveApi(cancelled);
    await renderDetailsPage(cancelled.id);
    await screen.findByRole('heading', { name: 'feb-legacy-import.csv' });
    expect(screen.queryByText(fullyReviewedMessage)).not.toBeInTheDocument();
  });

  // AC-4
  it('lists each processing stage in order with its start and finish times, and an unfinished stage as in progress', async () => {
    // may-suppliers.csv: four finished stages, then Check rows still running.
    const processing = seeded(DASHBOARD_FILE_IDS.processing);
    serveApi(processing);
    await renderDetailsPage(processing.id);

    const history = await screen.findByRole('table', {
      name: /processing history/i,
    });
    const stageRows = within(history)
      .getAllByRole('row')
      .map((row) =>
        within(row)
          .queryAllByRole('cell')
          .map((cell) => cell.textContent?.trim() ?? ''),
      )
      .filter((cells) => cells.length > 0);

    const [receive, duplicateCheck, readRows, convertTypes, checkRows] =
      processing.processingHistory;
    const finished = (iso: string | null) => (iso ? localSeconds(iso) : '');

    expect(stageRows).toEqual([
      [
        'Received',
        localSeconds(receive.startedAt),
        finished(receive.finishedAt),
      ],
      [
        'Duplicate check',
        localSeconds(duplicateCheck.startedAt),
        finished(duplicateCheck.finishedAt),
      ],
      [
        'Read rows',
        localSeconds(readRows.startedAt),
        finished(readRows.finishedAt),
      ],
      [
        'Convert values',
        localSeconds(convertTypes.startedAt),
        finished(convertTypes.finishedAt),
      ],
      ['Check rows', localSeconds(checkRows.startedAt), 'In progress'],
    ]);
  });

  // AC-5
  it('shows loading, then a problem with Retry that reloads, and "File not found" for an unknown file', async () => {
    const user = userEvent.setup();
    const details = seeded(DASHBOARD_FILE_IDS.aprilBatch1);

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
      if (url === `/files/${encodeURIComponent(details.id)}`) {
        return Promise.resolve(details);
      }
      return Promise.reject({ message: 'Not found', statusCode: 404 });
    });
    const failing = await renderDetailsPage(details.id);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    failNextLoad = false;
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(
      await screen.findByRole('heading', { name: 'april-batch-1.csv' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    failing.unmount();

    // Not found: the back-end answers 404 for an unknown id.
    mockGet.mockImplementation(() =>
      Promise.reject({ message: FILE_NOT_FOUND_MESSAGE, statusCode: 404 }),
    );
    await renderDetailsPage(UNKNOWN_FILE_ID);
    expect(await screen.findByText(/file not found/i)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /back to dashboard/i }),
    ).toHaveAttribute('href', expect.stringMatching(/^\/dashboard(\?|$)/));
  });
});
