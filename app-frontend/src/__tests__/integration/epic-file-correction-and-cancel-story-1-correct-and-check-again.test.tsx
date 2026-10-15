/**
 * Story Metadata:
 * - Route: /dashboard/files/[fileId]/corrections
 * - Target File: app-frontend/src/app/(authenticated)/dashboard/files/[fileId]/corrections/page.tsx
 * - Page Action: create_new
 *
 * Tests for Epic file-correction-and-cancel, Story 1: correct invalid rows and check
 * the file again. Vitest covers AC-1, AC-2 and AC-6 (AC-3, AC-4, AC-5 are Playwright).
 *
 * Render scope: component level. `RouteGuard` / `requireSession` are server-only, so
 * the client views are rendered directly inside the providers the real layouts mount
 * (ToastProvider + EventsProvider + ToastContainer). The page module is only called
 * to check what it returns.
 *
 * Contracts these tests pin (the developer implements to them):
 * - Corrections page default export takes `{ params: Promise<{ fileId }> }` and
 *   returns `<RouteGuard route={...}>` as its OUTERMOST element (the route is the new
 *   Importer-only, not-in-menu access row; its literal is not pinned here), whose
 *   direct child is `<CorrectionsView fileId={fileId} />` (keyed by fileId).
 * - `@/components/files/CorrectionsView` exports `CorrectionsView`, a client
 *   component with props `{ fileId: string }`. It loads `getFile(fileId)` and
 *   `getInvalidRows(fileId)` from `@/lib/api/endpoints`.
 * - `@/components/files/FileDetailsView`'s `FileDetailsView` takes
 *   `{ fileId: string; role: UserRole }`. In its file-actions area it shows a link
 *   "Correct invalid rows" -> `/dashboard/files/<id>/corrections` for an Importer only,
 *   when status Failed + failureKind InvalidRows + not cancelled; absent otherwise.
 * - Correction screen: file name heading; "Invalid rows" heading; text
 *   "<N> rows still need correcting"; one `<section aria-labelledby>` per row whose
 *   accessible name is exactly "Row <rowNumber>", containing its reasons as list items
 *   (back-end wording) and seven inputs labelled Reference, Transaction date,
 *   Account number, Description, Amount, Transaction type, Currency (label text may
 *   end with "*"), pre-filled with the file values. Transaction date, Account number,
 *   Amount and Transaction type carry the `required` attribute; the other three don't.
 * - Field problems are validated on blur (not while typing) and on "Check again",
 *   and are linked to the input via `aria-describedby` (its accessible description),
 *   worded as the back-end reasons ("Invalid Amount", ...).
 * - Actions: buttons "Save changes" and "Check again". While a request runs both are
 *   `disabled` and the pressed one reads "Saving…" / "Checking…". A failed request
 *   shows a problem (`role="alert"`, e.g. an error toast) with a "Try again" button
 *   that resends the same request; the edits stay in the form. Once the retried
 *   request succeeds, that problem (and its "Try again") is dismissed. "Save changes" calls
 *   `saveCorrections` (PATCH via `apiClient`) with `{ rows }` = only changed rows, each
 *   with `id` + all seven fields as strings; success shows "Changes saved.". "Check
 *   again" calls `recheckFile` (`post`) with `{ corrections }`; Completed ->
 *   `router.push('/dashboard/files/<id>')`.
 *
 * Only `@/lib/api/client` and `next/navigation` are mocked; the mocked API serves the
 * shared seeded data from `@/mocks/data/*` (read-only).
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Will fail until implemented (TDD red)
import CorrectionsPage from '@/app/(authenticated)/dashboard/files/[fileId]/corrections/page';
import { CorrectionsView } from '@/components/files/CorrectionsView';
import { FileDetailsView } from '@/components/files/FileDetailsView';
import { RouteGuard } from '@/components/shell/RouteGuard';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { EventsProvider } from '@/contexts/EventsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { apiClient, get, post } from '@/lib/api/client';
// Project-wide mock data shared with the Playwright layer (never re-defined here).
import { DASHBOARD_FILE_IDS, seededFileDetails } from '@/mocks/data/files';
import { userInfoFor } from '@/mocks/data/identity';
import {
  FIXING_CORRECTIONS,
  INVALID_AMOUNT,
  INVALID_TRANSACTION_DATE,
  MISSING_ACCOUNT_NUMBER,
  applyCorrections,
  createRecheckResult,
  invalidRowListOf,
  seededInvalidRows,
  toRowCorrection,
} from '@/mocks/data/invalidRows';
import type { FileDetails, UserRole } from '@/types/api-generated';

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: navigation.push,
    replace: navigation.replace,
    refresh: navigation.refresh,
    back: vi.fn(),
  }),
  usePathname: () =>
    '/dashboard/files/7c1e2a40-0000-4000-8000-000000000006/corrections',
  useSearchParams: () => new URLSearchParams(),
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

const FILE_ID = DASHBOARD_FILE_IDS.invalidRows;

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

/** A promise the test settles by hand (to hold a request pending). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The API client's network error (the back-end could not be reached). */
const NETWORK_ERROR = {
  message: 'Unable to reach the server',
  statusCode: 0,
  isNetworkError: true,
};

function seeded(id: string): FileDetails {
  const details = seededFileDetails(id);
  if (!details) {
    throw new Error(`No seeded file with id ${id}`);
  }
  return details;
}

/** Serves GET: a seeded file's details, its invalid rows, and the signed-in user. */
function serveGet(role: UserRole = 'Importer') {
  mockGet.mockImplementation((url: unknown) => {
    if (typeof url === 'string') {
      const details = url.match(/^\/files\/([^/]+)$/);
      if (details) {
        return Promise.resolve(seeded(decodeURIComponent(details[1])));
      }
      const rows = url.match(/^\/files\/([^/]+)\/invalid-rows$/);
      if (rows) {
        return Promise.resolve(seededInvalidRows(decodeURIComponent(rows[1])));
      }
      if (url === '/auth/me') {
        return Promise.resolve(userInfoFor(role));
      }
    }
    return Promise.reject({ message: 'Not found', statusCode: 404 });
  });
}

function withProviders(content: ReactNode) {
  return render(
    <ToastProvider>
      <EventsProvider>{content}</EventsProvider>
      <ToastContainer />
    </ToastProvider>,
  );
}

/** Renders the correction screen for `fileId` and waits for its rows. */
async function renderCorrections(fileId: string = FILE_ID) {
  const result = withProviders(<CorrectionsView fileId={fileId} />);
  await screen.findByRole('heading', { name: /invalid rows/i });
  return result;
}

function rowCard(rowNumber: number): HTMLElement {
  return screen.getByRole('region', { name: `Row ${rowNumber}` });
}

function field(card: HTMLElement, label: RegExp): HTMLInputElement {
  return within(card).getByLabelText(label) as HTMLInputElement;
}

/** The request payload `endpoint` was last sent with via `post`. */
function lastPostBody(endpoint: string): unknown {
  const calls = mockPost.mock.calls.filter((call) => call[0] === endpoint);
  return calls[calls.length - 1]?.[1];
}

/** Every JSON body sent to `endpoint` via `apiClient` with method `method`. */
function apiClientBodies(endpoint: string, method: string): unknown[] {
  return mockApiClient.mock.calls
    .filter(
      (call) =>
        call[0] === endpoint &&
        typeof call[1]?.method === 'string' &&
        call[1].method.toUpperCase() === method,
    )
    .map((call) => JSON.parse(String(call[1].body)));
}

describe('Epic file-correction-and-cancel, Story 1: correct invalid rows and check again', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('EventSource', FakeEventSource);
    serveGet();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // AC-1
  it('offers "Correct invalid rows" to an Importer on a file failed by invalid rows, listing only those rows with their values, reasons and count', async () => {
    const correctLink = { name: /correct invalid rows/i };

    // Offered: an Importer on april-invalid-rows.csv (Failed, InvalidRows).
    const offered = withProviders(
      <FileDetailsView fileId={FILE_ID} role="Importer" />,
    );
    await screen.findByRole('heading', { name: 'april-invalid-rows.csv' });
    expect(screen.getByRole('link', correctLink)).toHaveAttribute(
      'href',
      `/dashboard/files/${FILE_ID}/corrections`,
    );
    offered.unmount();

    // Hidden for an Approver on the same file.
    serveGet('Approver');
    const approver = withProviders(
      <FileDetailsView fileId={FILE_ID} role="Approver" />,
    );
    await screen.findByRole('heading', { name: 'april-invalid-rows.csv' });
    expect(screen.queryByRole('link', correctLink)).not.toBeInTheDocument();
    approver.unmount();

    // Hidden for a file that failed as a duplicate, and for a cancelled invalid-rows file.
    serveGet();
    const duplicate = withProviders(
      <FileDetailsView fileId={DASHBOARD_FILE_IDS.duplicate} role="Importer" />,
    );
    await screen.findByRole('heading', { name: 'bank-export-copy.csv' });
    expect(screen.queryByRole('link', correctLink)).not.toBeInTheDocument();
    duplicate.unmount();

    const cancelled = withProviders(
      <FileDetailsView
        fileId={DASHBOARD_FILE_IDS.cancelledFailed}
        role="Importer"
      />,
    );
    await screen.findByRole('heading', { name: 'wrong-bank-format.csv' });
    expect(screen.queryByRole('link', correctLink)).not.toBeInTheDocument();
    cancelled.unmount();

    // The page is guarded and renders the correction screen for its file.
    const element = await (
      CorrectionsPage as unknown as (props: {
        params: Promise<{ fileId: string }>;
        searchParams: Promise<Record<string, string>>;
      }) => ReactNode | Promise<ReactNode>
    )({
      params: Promise.resolve({ fileId: FILE_ID }),
      searchParams: Promise.resolve({}),
    });
    if (!isValidElement(element)) {
      throw new Error('The page did not return a React element');
    }
    const guarded = element as ReactElement<{ children: ReactNode }>;
    expect(guarded.type).toBe(RouteGuard);
    const child = guarded.props.children as ReactElement<{ fileId: string }>;
    expect(child.type).toBe(CorrectionsView);
    expect(child.props.fileId).toBe(FILE_ID);

    // The correction screen: only the two invalid rows, values, reasons and count.
    await renderCorrections();
    expect(
      screen.getByRole('heading', { name: 'april-invalid-rows.csv' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2 rows still need correcting/i),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /^Row \d+$/ })).toHaveLength(
      2,
    );

    const row4 = rowCard(4);
    expect(
      within(row4)
        .getAllByRole('listitem')
        .map((item) => item.textContent?.trim()),
    ).toEqual([INVALID_TRANSACTION_DATE, MISSING_ACCOUNT_NUMBER]);
    expect(field(row4, /^reference/i)).toHaveValue('APRIL-INVALID-ROWS-0004');
    expect(field(row4, /^transaction date/i)).toHaveValue('2026/13/45 08:04');
    expect(field(row4, /^account number/i)).toHaveValue('');
    expect(field(row4, /^description/i)).toHaveValue('Mock row 4');
    expect(field(row4, /^amount/i)).toHaveValue('249.00');
    expect(field(row4, /^transaction type/i)).toHaveValue('C');
    expect(field(row4, /^currency/i)).toHaveValue('ZAR');

    // Required fields are marked; the others are not.
    expect(field(row4, /^transaction date/i)).toBeRequired();
    expect(field(row4, /^account number/i)).toBeRequired();
    expect(field(row4, /^amount/i)).toBeRequired();
    expect(field(row4, /^transaction type/i)).toBeRequired();
    expect(field(row4, /^reference/i)).not.toBeRequired();
    expect(field(row4, /^description/i)).not.toBeRequired();
    expect(field(row4, /^currency/i)).not.toBeRequired();

    const row11 = rowCard(11);
    expect(
      within(row11)
        .getAllByRole('listitem')
        .map((item) => item.textContent?.trim()),
    ).toEqual([INVALID_AMOUNT]);
    expect(field(row11, /^reference/i)).toHaveValue('APRIL-INVALID-ROWS-0011');
    expect(field(row11, /^amount/i)).toHaveValue('-509.75');
    expect(field(row11, /^account number/i)).toHaveValue('1001-2034-5567');
  });

  // AC-2
  it('checks each field when the Importer leaves it and again on "Check again", showing the problem under the field', async () => {
    const user = userEvent.setup();
    await renderCorrections();
    const row4 = rowCard(4);
    const row11 = rowCard(11);

    // Amount: not checked while typing, checked on leaving the field.
    const amount = field(row11, /^amount/i);
    await user.clear(amount);
    await user.type(amount, '-5');
    expect(amount).not.toHaveAccessibleDescription(/invalid amount/i);
    await user.tab();
    await waitFor(() =>
      expect(amount).toHaveAccessibleDescription(/invalid amount/i),
    );

    // More than two decimals is also refused; a valid amount clears the problem.
    await user.clear(amount);
    await user.type(amount, '12.345');
    await user.tab();
    await waitFor(() =>
      expect(amount).toHaveAccessibleDescription(/invalid amount/i),
    );
    await user.clear(amount);
    await user.type(amount, '509.75');
    await user.tab();
    await waitFor(() =>
      expect(amount).not.toHaveAccessibleDescription(/invalid amount/i),
    );

    // Transaction type must be C or D.
    const type = field(row11, /^transaction type/i);
    await user.clear(type);
    await user.type(type, 'Z');
    await user.tab();
    await waitFor(() =>
      expect(type).toHaveAccessibleDescription(/invalid transaction type/i),
    );

    // Account number must be filled in (spaces alone don't count).
    const account = field(row11, /^account number/i);
    await user.clear(account);
    await user.type(account, '   ');
    await user.tab();
    await waitFor(() =>
      expect(account).toHaveAccessibleDescription(/missing account number/i),
    );

    // Reference must not repeat another listed row's, ignoring case.
    const reference = field(row11, /^reference/i);
    await user.clear(reference);
    await user.type(reference, 'april-invalid-rows-0004');
    await user.tab();
    await waitFor(() =>
      expect(reference).toHaveAccessibleDescription(
        /duplicate reference in file/i,
      ),
    );

    // "Check again" checks the fields never touched too: row 4's impossible date.
    const date = field(row4, /^transaction date/i);
    expect(date).not.toHaveAccessibleDescription(/invalid transaction date/i);
    await user.click(screen.getByRole('button', { name: /check again/i }));
    await waitFor(() =>
      expect(date).toHaveAccessibleDescription(/invalid transaction date/i),
    );
    expect(field(row4, /^account number/i)).toHaveAccessibleDescription(
      /missing account number/i,
    );
  });

  // AC-6
  it('locks the actions and shows progress while saving or checking again, and keeps the edits with "Try again" when a request fails', async () => {
    const user = userEvent.setup();
    const invalidRowsEndpoint = `/files/${FILE_ID}/invalid-rows`;
    const recheckEndpoint = `/files/${FILE_ID}/recheck`;
    const [fixRow4, fixRow11] = FIXING_CORRECTIONS[FILE_ID];
    const seededRows = seededInvalidRows(FILE_ID).rows;

    await renderCorrections();
    const row4 = rowCard(4);
    const row11 = rowCard(11);

    // Save changes: pending, then fails.
    const firstSave = deferred<unknown>();
    mockApiClient.mockReturnValueOnce(firstSave.promise);
    const amount = field(row11, /^amount/i);
    await user.clear(amount);
    await user.type(amount, '509.75');
    await user.tab();
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(
      await screen.findByRole('button', { name: /saving…/i }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: /check again/i })).toBeDisabled();

    firstSave.reject(NETWORK_ERROR);
    const tryAgain = await screen.findByRole('button', { name: /try again/i });
    expect(screen.queryAllByRole('alert')).not.toEqual([]);
    expect(field(row11, /^amount/i)).toHaveValue('509.75');
    expect(
      screen.getByRole('button', { name: /save changes/i }),
    ).not.toBeDisabled();

    // Try again resends the same request: only the changed row, all seven values.
    const saved = invalidRowListOf(applyCorrections(seededRows, [fixRow11]));
    mockApiClient.mockResolvedValueOnce(saved);
    await user.click(tryAgain);
    expect(await screen.findByText(/changes saved\./i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /try again/i }),
    ).not.toBeInTheDocument();
    const saveBodies = apiClientBodies(invalidRowsEndpoint, 'PATCH');
    expect(saveBodies.at(-1)).toEqual({
      rows: [toRowCorrection(seededRows[1], { amount: '509.75' })],
    });
    expect(saveBodies[0]).toEqual(saveBodies.at(-1));

    // Check again: pending, then fails, then Try again loads the file.
    const firstCheck = deferred<unknown>();
    mockPost.mockReturnValueOnce(firstCheck.promise);
    const date = field(row4, /^transaction date/i);
    await user.clear(date);
    await user.type(date, fixRow4.transactionDate);
    await user.tab();
    const account = field(row4, /^account number/i);
    await user.type(account, fixRow4.accountNumber);
    await user.tab();
    await user.click(screen.getByRole('button', { name: /check again/i }));

    expect(
      await screen.findByRole('button', { name: /checking…/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /save changes/i }),
    ).toBeDisabled();

    firstCheck.reject(NETWORK_ERROR);
    const retryCheck = await screen.findByRole('button', {
      name: /try again/i,
    });
    expect(field(row4, /^transaction date/i)).toHaveValue(
      fixRow4.transactionDate,
    );
    expect(field(row4, /^account number/i)).toHaveValue(fixRow4.accountNumber);
    const sentFirst = lastPostBody(recheckEndpoint);
    expect(sentFirst).toEqual({ corrections: [fixRow4] });

    mockPost.mockResolvedValueOnce(createRecheckResult());
    await user.click(retryCheck);
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        `/dashboard/files/${FILE_ID}`,
      ),
    );
    expect(lastPostBody(recheckEndpoint)).toEqual(sentFirst);
  });
});
