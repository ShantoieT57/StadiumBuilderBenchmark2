/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: app-frontend/src/app/(authenticated)/transactions/page.tsx
 * - Page Action: modify_existing
 *
 * Tests for Epic approve-and-reject, Story 1: approve a transaction. Vitest covers
 * AC-1 and AC-5 (AC-2, AC-3, AC-4 and AC-6 are Playwright).
 *
 * Render scope: the page reads the signed-in role on the server (`requireSession()`),
 * which jsdom cannot run, so the list is rendered through its client component
 * `TransactionsList` with the role passed in, inside the providers the real layouts
 * mount (ToastProvider + ToastContainer + EventsProvider).
 *
 * Implementation contract these tests assume:
 * - `TransactionsList` (`@/components/transactions/TransactionsList`) takes a
 *   `role: UserRole` prop (the page passes `user.role` from `requireSession()`).
 * - For `role === 'Approver'`, every Imported row (desktop table row AND phone `<li>`
 *   in the "Transactions" list) has text buttons "Approve" and "Reject", each with a
 *   visually hidden " <reference>" suffix, so the accessible names are
 *   "Approve <reference>" / "Reject <reference>". Approved / Rejected rows have
 *   neither, and an Importer sees neither on any row (hidden, never disabled).
 * - Approve opens a shadcn AlertDialog (`role="alertdialog"`) named
 *   "Approve <reference>?" with buttons "Cancel" and "Approve". Confirming calls
 *   `approveTransaction(id)` from `@/lib/api/endpoints` (-> `post('/transactions/<id>/approve')`).
 * - While the request runs the confirm button reads "Approving…" and both dialog
 *   buttons are disabled.
 * - A network / 5xx failure keeps the dialog open with an inline `role="alert"`
 *   problem inside it and a "Try again" button that resends the approve.
 * - On 200 the dialog closes and the row shows the returned details (Approved, no
 *   Approve / Reject).
 *
 * Data-contract: the API client is mocked; the real proxy -> back-end chain is
 * verified by the Playwright spec and the manual checklist.
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Will fail until implemented (TDD red): the `role` prop and the row actions.
import { TransactionsList } from '@/components/transactions/TransactionsList';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { EventsProvider } from '@/contexts/EventsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { apiClient, get, post } from '@/lib/api/client';
// Project-wide mock data shared with the Playwright layer (never re-defined here).
import { createImportedTransactionCount } from '@/mocks/data/importedCount';
import { userInfoFor } from '@/mocks/data/identity';
import {
  SEEDED_APPROVED_NUMBERS,
  SEEDED_APPROVER_NAME,
  SEEDED_IMPORTED_NUMBERS,
  SEEDED_REJECTED_NUMBERS,
  approvedDetailsOf,
  pageOf,
  seedTransactionDetails,
  seededTransactionReference,
  toListItem,
} from '@/mocks/data/transactions';
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
  useSearchParams: () => new URLSearchParams(),
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

/** In-test back-end state, read on every request. */
let dataset: TransactionDetails[] = [];
let signedInRole: UserRole = 'Approver';
/** Answers POST /transactions/<id>/approve. */
let answerApprove: (id: string) => Promise<TransactionDetails>;

/** Page 1 of the default view (transaction date, newest first, 20 per page). */
function servePage(): unknown {
  const sorted = [...dataset].sort((a, b) =>
    a.transactionDate < b.transactionDate ? 1 : -1,
  );
  return pageOf(sorted.map(toListItem));
}

function routeGet(endpoint: unknown): Promise<unknown> {
  const url = String(endpoint);
  if (url === '/transactions') return Promise.resolve(servePage());
  if (url === '/transactions/imported-count') {
    return Promise.resolve(
      createImportedTransactionCount({
        count: dataset.filter((d) => d.status === 'Imported').length,
      }),
    );
  }
  if (url === '/auth/me') return Promise.resolve(userInfoFor(signedInRole));
  const match = dataset.find(
    (d) => url === `/transactions/${encodeURIComponent(d.id)}`,
  );
  if (match) return Promise.resolve(match);
  return Promise.reject({ message: 'Not found', statusCode: 404 });
}

function routePost(endpoint: unknown): Promise<unknown> {
  const url = String(endpoint);
  const match = dataset.find(
    (d) => url === `/transactions/${encodeURIComponent(d.id)}/approve`,
  );
  if (match) return answerApprove(match.id);
  return Promise.reject({ message: 'Not found', statusCode: 404 });
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The desktop table row of `reference`. */
function tableRow(reference: string): HTMLElement {
  const table = screen.getByRole('table');
  return within(table).getByRole('row', {
    name: new RegExp(escapeRegExp(reference)),
  });
}

/** The phone `<li>` of `reference`, found through its "Details for <reference>" link. */
function phoneRow(reference: string): HTMLElement {
  const list = screen.getByRole('list', { name: 'Transactions' });
  const details = within(list).getByRole('link', {
    name: `Details for ${reference}`,
  });
  const item = details.closest('li');
  if (!item) throw new Error(`No phone row for ${reference}`);
  return item;
}

const approveName = (reference: string) =>
  new RegExp(`^approve ${escapeRegExp(reference)}$`, 'i');
const rejectName = (reference: string) =>
  new RegExp(`^reject ${escapeRegExp(reference)}$`, 'i');
const anyDecision = /^(approve|reject)\b/i;

/** Seed numbers shown on page 1 of the default view (30 down to 11). */
const onFirstPage = (numbers: readonly number[]) =>
  numbers.filter((n) => n >= 11);

describe('Epic approve-and-reject, Story 1: approve a transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('EventSource', FakeEventSource);
    dataset = seedTransactionDetails();
    signedInRole = 'Approver';
    answerApprove = () =>
      Promise.reject({ message: 'Unexpected approve', statusCode: 500 });
    mockGet.mockImplementation((endpoint: unknown) => routeGet(endpoint));
    mockApiClient.mockImplementation((endpoint: unknown) => routeGet(endpoint));
    mockPost.mockImplementation((endpoint: unknown) => routePost(endpoint));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // AC-1
  it('gives an Approver Approve and Reject on every Imported row (table and phone rows) and on no Approved or Rejected row, and gives an Importer neither', async () => {
    const importedShown = onFirstPage(SEEDED_IMPORTED_NUMBERS);
    const decidedShown = onFirstPage([
      ...SEEDED_APPROVED_NUMBERS,
      ...SEEDED_REJECTED_NUMBERS,
    ]);

    const approverView = renderList('Approver');
    const table = await screen.findByRole('table');
    expect(
      within(table).getAllByRole('button', { name: /^approve\b/i }),
    ).toHaveLength(importedShown.length);
    expect(
      within(table).getAllByRole('button', { name: /^reject\b/i }),
    ).toHaveLength(importedShown.length);

    for (const n of importedShown) {
      const reference = seededTransactionReference(n);
      for (const row of [tableRow(reference), phoneRow(reference)]) {
        expect(
          within(row).getByRole('button', { name: approveName(reference) }),
        ).toBeInTheDocument();
        expect(
          within(row).getByRole('button', { name: rejectName(reference) }),
        ).toBeInTheDocument();
      }
    }

    for (const n of decidedShown) {
      const reference = seededTransactionReference(n);
      for (const row of [tableRow(reference), phoneRow(reference)]) {
        expect(
          within(row).queryByRole('button', { name: anyDecision }),
        ).not.toBeInTheDocument();
      }
    }
    approverView.unmount();

    // Importer: no Approve or Reject anywhere, not even on Imported rows.
    renderList('Importer');
    await screen.findByRole('table');
    const imported = seededTransactionReference(30);
    expect(
      within(tableRow(imported)).getByRole('link', { name: imported }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: anyDecision }),
    ).not.toBeInTheDocument();
  });

  // AC-5
  it('shows progress and locks the confirmation while approving, and offers "Try again" in the still-open confirmation after a failure', async () => {
    const user = userEvent.setup();
    const n = 30;
    const reference = seededTransactionReference(n);

    // The first attempt hangs until we fail it as a dropped connection.
    let failFirst: (reason: unknown) => void = () => {};
    answerApprove = () =>
      new Promise<TransactionDetails>((_resolve, reject) => {
        failFirst = reject;
      });

    renderList('Approver');
    await screen.findByRole('table');
    await user.click(
      within(tableRow(reference)).getByRole('button', {
        name: approveName(reference),
      }),
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: `Approve ${reference}?`,
    });
    await user.click(
      within(dialog).getByRole('button', { name: /^approve$/i }),
    );

    // In progress: shows progress, and neither button can be pressed again.
    const pending = await within(dialog).findByRole('button', {
      name: /approving/i,
    });
    expect(pending).toBeDisabled();
    expect(
      within(dialog).getByRole('button', { name: /^cancel$/i }),
    ).toBeDisabled();

    // A failed request: the confirmation stays open with a problem and "Try again".
    failFirst({
      message: 'Network error',
      statusCode: 0,
      isNetworkError: true,
    });
    const problem = await within(dialog).findByRole('alert');
    const tryAgain = within(problem).getByRole('button', {
      name: /try again/i,
    });
    expect(screen.getByRole('alertdialog')).toBe(dialog);

    // Trying again resends the approve, which now succeeds.
    answerApprove = (approvedId) => {
      const index = dataset.findIndex((d) => d.id === approvedId);
      const approved = approvedDetailsOf(dataset[index], {
        by: SEEDED_APPROVER_NAME,
        at: '2026-05-04T09:15:00Z',
      });
      dataset[index] = approved;
      return Promise.resolve(approved);
    };
    await user.click(tryAgain);

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        within(tableRow(reference)).getByText('Approved'),
      ).toBeInTheDocument();
    });
    expect(
      within(tableRow(reference)).queryByRole('button', { name: anyDecision }),
    ).not.toBeInTheDocument();

    // The row's Approve has gone, so focus moves to the row's details link.
    await waitFor(() => {
      expect(
        within(tableRow(reference)).getByRole('link', { name: reference }),
      ).toHaveFocus();
    });
  });
});
