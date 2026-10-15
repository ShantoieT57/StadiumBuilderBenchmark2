/**
 * Story Metadata:
 * - Route: /dashboard
 * - Target File: app-frontend/src/app/(authenticated)/dashboard/page.tsx
 *   (client list at app-frontend/src/components/files/FilesList.tsx - story 1,
 *    filter form at app-frontend/src/components/files/FileFilters.tsx - this story)
 * - Page Action: modify_existing
 *
 * Tests for Epic file-dashboard-and-details, Story 2: Filter the file list and show
 * cancelled files. Vitest covers AC-3 and AC-5 only (AC-1, AC-2, AC-4, AC-6 are
 * Playwright).
 *
 * Render scope: the client components directly. The page stays a server component
 * wrapped in `RouteGuard route="/dashboard"`, which jsdom cannot render.
 *
 * Contracts these tests pin (the developer implements to them):
 * - `@/components/files/FilesList` (story 1) exports `FilesList`, a client component
 *   taking `role: UserRole` ('Importer' | 'Approver', decides the Upload link). It
 *   reads the view (sort, page, pageSize, status, fileName, processedFrom,
 *   processedTo, visibility) from `useSearchParams()`, loads with `getFiles`
 *   (GET /files via the API client, query object as the second argument) and uses
 *   the shell's `useEvents()` (inside `EventsProvider`).
 * - `@/components/files/FileFilters` exports `FileFilters`, a client component with
 *   no required props. It reads the current filters from `useSearchParams()` and
 *   applies them by `useRouter().push('/dashboard?<query>')`. It renders ONE inline
 *   filter form in the DOM (the phone Sheet holds another only while open).
 *   react-hook-form `mode: 'onBlur'`, `reValidateMode: 'onBlur'`, zod
 *   (`lib/validation/fileFilters.ts`).
 * - Date fields are labelled "Processed from" and "Processed to" (native
 *   `<input type="date">`); the submit button's name contains "Apply".
 * - From after To -> the message sits on Processed from and names the "Processed to"
 *   date; the field gets `aria-invalid="true"` and `aria-describedby` pointing at the
 *   message. While the range is invalid no navigation carries it.
 * - URL keeps plain `yyyy-MM-dd`; the GET /files query carries `processedFrom` as the
 *   local start of day (`T00:00:00.000±HH:MM`) and `processedTo` as the local end of
 *   day (`T23:59:59.999±HH:MM`). A date in the URL that cannot be read is not sent.
 * - Active filters: a list named "Active filters" with one chip per filter (status in
 *   words, file name, the date range as `yyyy-MM-dd`, "Showing cancelled" /
 *   "Showing active and cancelled"); each chip has a remove button named
 *   "Remove <label> filter" (status chip: "Remove Status filter"); a "Clear all"
 *   button removes every filter.
 * - No-match state (filters set, zero files): a `<section>` labelled by its heading
 *   "No files match ..." listing the active filters and holding a "Clear all filters"
 *   button. "No files yet" never appears at the same time.
 *
 * Only `@/lib/api/client` and `next/navigation` are mocked; jsdom has no EventSource,
 * so the browser API is replaced with an inert stand-in for the real EventsProvider.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Imports below target not-yet-built modules - will fail until implemented (TDD red).
import { FilesList } from '@/components/files/FilesList';
import { FileFilters } from '@/components/files/FileFilters';
import { EventsProvider } from '@/contexts/EventsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { get } from '@/lib/api/client';
// Project-wide mock data shared with the Playwright layer.
import { filePageOf, seedDashboardFiles } from '@/mocks/data/files';
import type { FilePage } from '@/types/api-generated';

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

/** Serve GET /files with `page`; any other GET is unexpected here. */
function serveFiles(page: FilePage): void {
  mockGet.mockImplementation((path: string) => {
    if (path === '/files') {
      return Promise.resolve(page);
    }
    return Promise.reject(new Error(`Unexpected GET ${path} in this test`));
  });
}

/** The query of every GET /files the list sent. */
function fileQueries(): Record<string, unknown>[] {
  return mockGet.mock.calls
    .filter(([path]) => path === '/files')
    .map(([, params]) => (params ?? {}) as Record<string, unknown>);
}

/** Every URL the components navigated to (push or replace), as strings. */
function navigatedUrls(): string[] {
  return [...navigation.push.mock.calls, ...navigation.replace.mock.calls].map(
    (call) => String(call[0]),
  );
}

/** The search params of a navigated URL. */
function paramsOf(url: string): URLSearchParams {
  return new URL(url, 'http://localhost').searchParams;
}

function renderDashboard() {
  return render(
    <ToastProvider>
      <EventsProvider>
        <FileFilters />
        <FilesList role="Approver" />
      </EventsProvider>
    </ToastProvider>,
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

describe('Epic file-dashboard-and-details, Story 2: process-date range checks', () => {
  // AC-3
  it('refuses an unreadable date and a From after To, shows the problem on Processed from, and leaves the list unchanged until corrected', async () => {
    const user = userEvent.setup();
    // A From date that cannot be read arrives from a link.
    navigation.search = new URLSearchParams({
      processedFrom: '15/04/2026',
      processedTo: '2026-04-30',
    });
    serveFiles(filePageOf(seedDashboardFiles()));

    renderDashboard();

    // The list still loads; the unreadable date is not sent, the readable one is
    // sent as the local end of that day with the local offset.
    expect(
      (await screen.findAllByRole('link', { name: /april-batch-1\.csv/i }))[0],
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /retry/i }),
    ).not.toBeInTheDocument();
    const [firstQuery] = fileQueries();
    expect(firstQuery).not.toHaveProperty('processedFrom');
    expect(String(firstQuery.processedTo)).toMatch(
      /^2026-04-30T23:59:59\.999[+-]\d{2}:\d{2}$/,
    );

    // A From date after the To date: problem on Processed from when leaving it.
    const fromDate = screen.getByLabelText(/^processed from/i);
    const toDate = screen.getByLabelText(/^processed to/i);
    await user.clear(toDate);
    await user.type(toDate, '2026-04-29');
    await user.clear(fromDate);
    await user.type(fromDate, '2026-05-02');
    await user.tab();
    await waitFor(() => {
      expect(fromDate).toHaveAccessibleDescription(/processed to|to date/i);
    });
    expect(fromDate).toHaveAttribute('aria-invalid', 'true');

    // Applying keeps the problem and does not apply the reversed range.
    await user.click(screen.getByRole('button', { name: /apply/i }));
    expect(fromDate).toHaveAccessibleDescription(/processed to|to date/i);
    expect(fromDate).toHaveAttribute('aria-invalid', 'true');
    expect(navigatedUrls()).not.toContainEqual(
      expect.stringMatching(/processedFrom=2026-05-02/),
    );

    // Corrected: the problem goes and the plain dates reach the URL on page 1.
    await user.clear(fromDate);
    await user.type(fromDate, '2026-04-27');
    await user.click(screen.getByRole('button', { name: /apply/i }));
    await waitFor(() => {
      expect(navigatedUrls()).toContainEqual(
        expect.stringMatching(/processedFrom=2026-04-27(&|$)/),
      );
    });
    const applied = paramsOf(
      navigatedUrls().find((url) => /processedFrom=2026-04-27/.test(url)) ?? '',
    );
    expect(applied.get('processedTo')).toBe('2026-04-29');
    expect(applied.get('page')).toBeNull();
    expect(fromDate).not.toHaveAttribute('aria-invalid', 'true');
  });
});

describe('Epic file-dashboard-and-details, Story 2: active filters and no match', () => {
  // AC-5
  it('shows each active filter as a removable label, clears them all, and says no files match instead of "No files yet"', async () => {
    const user = userEvent.setup();
    navigation.search = new URLSearchParams({
      status: 'Failed',
      fileName: 'zzz-no-such-file',
      processedFrom: '2026-04-27',
      processedTo: '2026-04-29',
      visibility: 'Both',
    });
    serveFiles(filePageOf([]));

    renderDashboard();

    // The filters match no file: the no-match state, never "No files yet".
    const noMatch = await screen.findByRole('region', {
      name: /no files match/i,
    });
    expect(screen.queryByText(/no files yet/i)).not.toBeInTheDocument();
    expect(within(noMatch).getByText(/failed/i)).toBeInTheDocument();
    expect(within(noMatch).getByText(/zzz-no-such-file/)).toBeInTheDocument();

    // Each active filter is a label in the "Active filters" list.
    const chips = screen.getByRole('list', { name: /active filters/i });
    expect(within(chips).getByText(/failed/i)).toBeInTheDocument();
    expect(within(chips).getByText(/zzz-no-such-file/)).toBeInTheDocument();
    expect(within(chips).getByText(/2026-04-27/)).toBeInTheDocument();
    expect(within(chips).getByText(/2026-04-29/)).toBeInTheDocument();
    expect(
      within(chips).getByText(/showing active and cancelled/i),
    ).toBeInTheDocument();

    // Removing one label drops only that filter.
    await user.click(
      within(chips).getByRole('button', { name: /remove status filter/i }),
    );
    await waitFor(() => {
      expect(navigatedUrls()).toContainEqual(
        expect.stringMatching(/fileName=zzz-no-such-file/),
      );
    });
    const withoutStatus = paramsOf(
      navigatedUrls().find((url) => /fileName=zzz-no-such-file/.test(url)) ??
        '',
    );
    expect(withoutStatus.get('status')).toBeNull();
    expect(withoutStatus.get('visibility')).toBe('Both');

    // "Clear all" removes every filter.
    navigation.push.mockClear();
    navigation.replace.mockClear();
    await user.click(screen.getByRole('button', { name: /^clear all$/i }));
    await waitFor(() => {
      expect(navigatedUrls()).toContainEqual(
        expect.not.stringMatching(
          /(^|[?&])(status|fileName|processedFrom|processedTo|visibility)=/,
        ),
      );
    });

    // The no-match state's own action clears them all too.
    navigation.push.mockClear();
    navigation.replace.mockClear();
    await user.click(
      within(noMatch).getByRole('button', { name: /clear all filters/i }),
    );
    await waitFor(() => {
      expect(navigatedUrls()).toContainEqual(
        expect.not.stringMatching(
          /(^|[?&])(status|fileName|processedFrom|processedTo|visibility)=/,
        ),
      );
    });
  });
});
