/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: app-frontend/src/components/transactions/TransactionRowActions.tsx
 *   (+ new `@/components/transactions/RejectTransactionDialog`, schema
 *   `@/lib/validation/rejectReason`)
 * - Page Action: modify_existing
 *
 * Tests for Epic approve-and-reject, Story 2: reject a transaction with a reason.
 * Vitest covers AC-2, AC-4 and AC-6 (AC-1, AC-3, AC-5 are Playwright).
 *
 * Render scope: the row actions live inside the Transactions list, so the tests
 * render Story 1's client list `TransactionsList` with `role="Approver"` (the prop
 * Story 1 adds; the server page passes it from `requireSession()`), inside the
 * providers the real layouts mount (ToastProvider + ToastContainer + EventsProvider).
 * Queries are scoped to the desktop `<table>` (the phone rows are CSS-hidden copies).
 *
 * Contracts these tests pin (the developer implements to them):
 * - An Imported row's "Reject" trigger is a button whose accessible name starts with
 *   "Reject" (plus a visually hidden " <reference>"). It opens a shadcn Dialog
 *   (`role="dialog"`) named "Reject <reference>?".
 * - The dialog holds a textarea labelled "Reason" (required, visible `*`), a counter
 *   reading "<N> characters left" (500 minus the TRIMMED `.length`, i.e. UTF-16 code
 *   units like the server) or "<N> characters too many" when over; the counter text
 *   appears once in the dialog (the visible counter is itself the polite live region).
 *   The field is NOT hard-capped: pasted text over 500 stays in full.
 * - Buttons "Cancel" and "Reject"; "Reject" is disabled while the trimmed reason is
 *   empty. Validation (react-hook-form `mode: 'onBlur'`, zod) on leaving the field and
 *   on submit: "Enter a reason for rejecting." / "The reason can be at most 500
 *   characters." under the field, linked via `aria-describedby`.
 * - Submit calls `rejectTransaction(id, { reason: trimmed })` from
 *   `@/lib/api/endpoints` (-> `post('/transactions/<id>/reject', { reason })`).
 *   While pending: the submit reads "Rejecting…", and it, "Cancel" and the field are
 *   disabled.
 * - 400 with `errors.reason` -> the server's message under the field (aria-describedby),
 *   dialog open, reason kept. Other 400 keys -> one inline `role="alert"` in the dialog.
 * - Network / 5xx -> inline `role="alert"` in the dialog with "Try again" (resends the
 *   same trimmed reason); the typed reason is kept.
 * - 200 -> dialog closes, success toast "<reference> rejected." in Notifications.
 *
 * Data-contract: the API client is mocked; the real proxy -> back-end chain is
 * verified by the Playwright spec and the manual checklist.
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Target module (Story 1 adds the `role` prop and the row actions) - TDD red.
import { TransactionsList } from '@/components/transactions/TransactionsList';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { EventsProvider } from '@/contexts/EventsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { apiClient, get, post } from '@/lib/api/client';
// Project-wide mock data shared with the Playwright layer (never re-defined here).
import { userInfoFor } from '@/mocks/data/identity';
import { createImportedTransactionCount } from '@/mocks/data/importedCount';
import {
  ALREADY_REJECTED_MESSAGE,
  REJECTION_REASON_REQUIRED_MESSAGE,
  pageOf,
  rejectedDetailsOf,
  seedTransactionDetails,
  seededTransactionId,
  seededTransactionReference,
  toListItem,
} from '@/mocks/data/transactions';
import type { TransactionDetails } from '@/types/api-generated';

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

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
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

/** Seeded transaction 30: Imported, first row of the default view. */
const TARGET_NUMBER = 30;
const TARGET_ID = seededTransactionId(TARGET_NUMBER);
const TARGET_REFERENCE = seededTransactionReference(TARGET_NUMBER);
const REJECT_URL = `/transactions/${encodeURIComponent(TARGET_ID)}/reject`;

/** In-test back-end state, read on every request. */
let dataset: TransactionDetails[] = [];
/** Every body the UI sent to POST reject, in order. */
let sentBodies: unknown[] = [];
/** Answers POST reject; the default would surface as a visible problem. */
let answerReject: (body: unknown) => Promise<unknown>;

function targetDetails(): TransactionDetails {
  const details = dataset.find((item) => item.id === TARGET_ID);
  if (!details) throw new Error('Seeded transaction 30 is missing');
  return details;
}

function routeGet(endpoint: unknown): Promise<unknown> {
  const url = String(endpoint);
  if (url === '/transactions') {
    // Default view: transaction date descending (seed order is 1 Apr .. 30 Apr).
    return Promise.resolve(pageOf([...dataset].reverse().map(toListItem)));
  }
  if (url === '/transactions/imported-count') {
    return Promise.resolve(
      createImportedTransactionCount({
        count: dataset.filter((item) => item.status === 'Imported').length,
      }),
    );
  }
  if (url === `/transactions/${encodeURIComponent(TARGET_ID)}`) {
    return Promise.resolve(targetDetails());
  }
  if (url === '/auth/me') return Promise.resolve(userInfoFor('Approver'));
  return Promise.reject({ message: `Unexpected ${url}`, statusCode: 404 });
}

function routePost(endpoint: unknown, body?: unknown): Promise<unknown> {
  const url = String(endpoint);
  if (url === REJECT_URL) {
    sentBodies.push(body);
    return answerReject(body);
  }
  return Promise.reject({ message: `Unexpected ${url}`, statusCode: 404 });
}

function renderList() {
  return render(
    <ToastProvider>
      <EventsProvider>
        <TransactionsList role="Approver" />
      </EventsProvider>
      <ToastContainer />
    </ToastProvider>,
  );
}

/** Opens the Reject dialog of seeded transaction 30 from its table row. */
async function openRejectDialog(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  renderList();
  const table = await screen.findByRole('table');
  const row = await within(table).findByRole('row', {
    name: new RegExp(TARGET_REFERENCE),
  });
  await user.click(within(row).getByRole('button', { name: /^reject/i }));
  return screen.findByRole('dialog', { name: `Reject ${TARGET_REFERENCE}?` });
}

describe('Epic approve-and-reject, Story 2: reject with a reason', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.connections = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    dataset = seedTransactionDetails();
    sentBodies = [];
    answerReject = () =>
      Promise.reject({ message: 'Unexpected reject', statusCode: 500 });
    mockGet.mockImplementation((endpoint: unknown) => routeGet(endpoint));
    mockApiClient.mockImplementation((endpoint: unknown) => routeGet(endpoint));
    mockPost.mockImplementation((endpoint: unknown, body?: unknown) =>
      routePost(endpoint, body),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // AC-2
  it('checks the reason on leaving the field and on submit: only spaces is missing, over 500 trimmed characters is too long, and the count ignores outer spaces and counts like the server', async () => {
    const user = userEvent.setup();
    const dialog = await openRejectDialog(user);
    const reason = within(dialog).getByLabelText(/reason/i);
    const submit = within(dialog).getByRole('button', { name: /^reject$/i });

    expect(within(dialog).getByText('500 characters left')).toBeInTheDocument();
    expect(submit).toBeDisabled();

    // Only spaces: still unavailable, and refused as missing on leaving the field.
    await user.type(reason, '     ');
    expect(submit).toBeDisabled();
    expect(within(dialog).getByText('500 characters left')).toBeInTheDocument();
    await user.tab();
    expect(
      await within(dialog).findByText('Enter a reason for rejecting.'),
    ).toBeInTheDocument();
    expect(reason).toHaveAccessibleDescription(
      /enter a reason for rejecting\./i,
    );

    // Leading and trailing spaces are not counted ("Duplicate payment" = 17).
    await user.clear(reason);
    await user.type(reason, '  Duplicate payment  ');
    expect(
      await within(dialog).findByText('483 characters left'),
    ).toBeInTheDocument();
    expect(submit).toBeEnabled();

    // Counted as UTF-16 code units like the server: 498 letters + one emoji = 500.
    await user.clear(reason);
    await user.click(reason);
    await user.paste(`  ${'a'.repeat(498)}😀  `);
    expect(
      await within(dialog).findByText('0 characters left'),
    ).toBeInTheDocument();

    // 499 letters + one emoji = 501: shown as too many, kept in full, refused on
    // leaving the field and on submit, and nothing is sent.
    const tooLong = `${'a'.repeat(499)}😀`;
    await user.clear(reason);
    await user.click(reason);
    await user.paste(tooLong);
    expect(
      await within(dialog).findByText(/^1 characters? too many$/),
    ).toBeInTheDocument();
    expect(reason).toHaveValue(tooLong);
    await user.tab();
    expect(
      await within(dialog).findByText(
        'The reason can be at most 500 characters.',
      ),
    ).toBeInTheDocument();
    expect(reason).toHaveAccessibleDescription(
      /the reason can be at most 500 characters\./i,
    );

    await user.click(submit);
    expect(
      within(dialog).getByText('The reason can be at most 500 characters.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('dialog', { name: `Reject ${TARGET_REFERENCE}?` }),
    ).toBeInTheDocument();
    expect(sentBodies).toEqual([]);
  });

  // AC-4
  it('shows a reason the server refuses under the Reason field and keeps the form open with the typed reason; other refusals show above the buttons', async () => {
    const user = userEvent.setup();
    answerReject = () =>
      Promise.reject({
        message: 'One or more validation errors occurred.',
        statusCode: 400,
        errors: { reason: [REJECTION_REASON_REQUIRED_MESSAGE] },
      });

    const dialog = await openRejectDialog(user);
    const reason = within(dialog).getByLabelText(/reason/i);
    await user.type(reason, 'Duplicate payment');
    await user.click(within(dialog).getByRole('button', { name: /^reject$/i }));

    expect(
      await within(dialog).findByText(REJECTION_REASON_REQUIRED_MESSAGE),
    ).toBeInTheDocument();
    expect(reason).toHaveAccessibleDescription(
      new RegExp(REJECTION_REASON_REQUIRED_MESSAGE.replace(/\./g, '\\.')),
    );
    expect(
      screen.getByRole('dialog', { name: `Reject ${TARGET_REFERENCE}?` }),
    ).toBeInTheDocument();
    expect(reason).toHaveValue('Duplicate payment');
    expect(sentBodies).toEqual([{ reason: 'Duplicate payment' }]);

    // A refusal keyed on something else shows in one inline problem in the dialog.
    answerReject = () =>
      Promise.reject({
        message: 'One or more validation errors occurred.',
        statusCode: 400,
        errors: { $: ['A non-empty request body is required.'] },
      });
    await user.click(within(dialog).getByRole('button', { name: /^reject$/i }));
    const problem = await within(dialog).findByRole('alert');
    expect(problem).toHaveTextContent('A non-empty request body is required.');
    expect(reason).toHaveValue('Duplicate payment');
  });

  // AC-6
  it('shows progress and cannot be submitted twice while rejecting; a failure shows "Try again" with the typed reason kept, and trying again rejects it', async () => {
    const user = userEvent.setup();
    let failFirst: (reason: unknown) => void = () => {};
    answerReject = () =>
      new Promise((_resolve, reject) => {
        failFirst = reject;
      });

    const dialog = await openRejectDialog(user);
    const reason = within(dialog).getByLabelText(/reason/i);
    await user.type(reason, '  Duplicate payment  ');
    await user.click(within(dialog).getByRole('button', { name: /^reject$/i }));

    // In progress: shows progress; nothing can be pressed or edited again.
    const pending = await within(dialog).findByRole('button', {
      name: /rejecting/i,
    });
    expect(pending).toBeDisabled();
    expect(
      within(dialog).getByRole('button', { name: /^cancel$/i }),
    ).toBeDisabled();
    expect(reason).toBeDisabled();
    await user.click(pending);
    expect(sentBodies).toEqual([{ reason: 'Duplicate payment' }]);

    // Another kind of failure: a problem with "Try again", the reason kept.
    failFirst({
      message: 'Network error',
      statusCode: 0,
      isNetworkError: true,
    });
    const problem = await within(dialog).findByRole('alert');
    const tryAgain = within(problem).getByRole('button', {
      name: /try again/i,
    });
    expect((reason as HTMLTextAreaElement).value.trim()).toBe(
      'Duplicate payment',
    );

    // Trying again sends the same trimmed reason and rejects it.
    answerReject = (body) => {
      const sent = body as { reason: string };
      const rejected = rejectedDetailsOf(targetDetails(), sent.reason, {
        by: 'Approver User',
        at: '2026-05-04T08:15:00Z',
      });
      dataset = dataset.map((item) =>
        item.id === TARGET_ID ? rejected : item,
      );
      return Promise.resolve(rejected);
    };
    await user.click(tryAgain);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    const notifications = screen.getByRole('region', {
      name: /notifications/i,
    });
    expect(
      await within(notifications).findByText(`${TARGET_REFERENCE} rejected.`),
    ).toBeInTheDocument();
    expect(sentBodies).toEqual([
      { reason: 'Duplicate payment' },
      { reason: 'Duplicate payment' },
    ]);
  });

  // R14 (RJ-05): someone else decided first, seen by a live refresh.
  it('closes an open Reject form and says the transaction was already rejected when a live refresh shows someone else rejected it first', async () => {
    const user = userEvent.setup();
    const dialog = await openRejectDialog(user);
    await user.type(
      within(dialog).getByLabelText(/reason/i),
      'Duplicate payment',
    );

    // Another approver rejects it; the back-end announces the change.
    const rejected = rejectedDetailsOf(targetDetails(), 'Wrong account', {
      by: 'Another Approver',
      at: '2026-05-04T08:15:00Z',
    });
    dataset = dataset.map((item) => (item.id === TARGET_ID ? rejected : item));
    const [connection] = FakeEventSource.connections;
    expect(connection).toBeDefined();
    act(() =>
      connection.emit('transactions-changed', { fileId: rejected.file.id }),
    );

    // The form closes, nothing is sent, and a lasting problem says why.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    const notifications = screen.getByRole('region', {
      name: /notifications/i,
    });
    const problem = await within(notifications).findByRole('alert');
    expect(problem).toHaveTextContent(ALREADY_REJECTED_MESSAGE);
    expect(problem).toHaveTextContent(
      'It is now Rejected. Reason: Wrong account',
    );
    expect(sentBodies).toEqual([]);

    // Focus is back on the row's details link.
    const row = within(screen.getByRole('table')).getByRole('row', {
      name: new RegExp(TARGET_REFERENCE),
    });
    await waitFor(() => {
      expect(
        within(row).getByRole('link', { name: TARGET_REFERENCE }),
      ).toHaveFocus();
    });
  });
});
