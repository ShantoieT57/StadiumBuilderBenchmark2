/**
 * Story Metadata:
 * - Route: /dashboard/files/[fileId]
 * - Target File: app-frontend/src/app/(authenticated)/dashboard/files/[fileId]/page.tsx
 * - Page Action: modify_existing
 *
 * Tests for Epic file-correction-and-cancel, Story 3: cancel a file. Vitest covers
 * AC-1 and AC-6 (AC-2..AC-5 are Playwright).
 *
 * Render scope: the details page reads the signed-in role on the server
 * (`requireSession()`), which jsdom cannot run, so the details are rendered through
 * their client component `FileDetailsView` with the role passed in, inside the
 * providers the real layouts mount (ToastProvider + ToastContainer + EventsProvider).
 * The correction screen is rendered through its page module (Story 1), whose
 * outermost element is a `RouteGuard`; its guarded children are rendered.
 *
 * Implementation contract these tests assume:
 * - `FileDetailsView` (`@/components/files/FileDetailsView`) takes
 *   `{ fileId: string; role: UserRole }` (the `role` prop added in Story 1; the page
 *   passes `user.role` from `requireSession()`).
 * - The cancel action is ONE shared component (suggested
 *   `@/components/files/CancelFileDialog`, not imported here) placed in the details
 *   header actions area and on the correction screen header: a button named
 *   "Cancel file", rendered for an Importer on any file that is not cancelled and
 *   NOT rendered for an Approver or on a cancelled file.
 * - It opens a shadcn AlertDialog (`role="alertdialog"`) named "Cancel <file name>?"
 *   with buttons "Keep file" and "Cancel file". Confirming calls
 *   `cancelFile(fileId)` from `@/lib/api/endpoints` (-> `post('/files/<id>/cancel')`).
 * - While the request runs, the confirm button reads "Cancelling…" and both dialog
 *   buttons are disabled.
 * - On 200 (including the idempotent answer for a file someone else already
 *   cancelled) the dialog closes and the details render the RETURNED `FileDetails`
 *   at once: "Cancelled on <yyyy-MM-dd HH:mm local> by <name>" with the original
 *   time and person, and no problem message in the Notifications region.
 * - A network / other failure keeps the dialog open with an inline `role="alert"`
 *   problem inside it and a "Try again" button that sends the cancel again.
 *
 * Data-contract: the API client is mocked; the real proxy -> back-end chain is
 * verified by the Playwright spec and the manual checklist.
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Will fail until implemented (TDD red)
import CorrectionsPage from '@/app/(authenticated)/dashboard/files/[fileId]/corrections/page';
import { FileDetailsView } from '@/components/files/FileDetailsView';
import { RouteGuard } from '@/components/shell/RouteGuard';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { EventsProvider } from '@/contexts/EventsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { apiClient, get, post } from '@/lib/api/client';
// Project-wide mock data shared with the Playwright layer (never re-defined here).
import {
  DASHBOARD_FILE_IDS,
  cancelledFileDetails,
  seededFileDetails,
} from '@/mocks/data/files';
import { userInfoFor } from '@/mocks/data/identity';
import { seededInvalidRows } from '@/mocks/data/invalidRows';
import type { FileDetails, UserRole } from '@/types/api-generated';

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

/** Next page props, loose enough for the page's signature. */
type PageModule = (props: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string>>;
}) => ReactNode | Promise<ReactNode>;

function withProviders(children: ReactNode) {
  return (
    <ToastProvider>
      <EventsProvider>{children}</EventsProvider>
      <ToastContainer />
    </ToastProvider>
  );
}

function renderDetails(fileId: string, role: UserRole) {
  return render(withProviders(<FileDetailsView fileId={fileId} role={role} />));
}

/** Renders the correction screen's guarded content (Story 1's page module). */
async function renderCorrections(
  fileId: string,
): Promise<{ unmount: () => void }> {
  const element = await (CorrectionsPage as unknown as PageModule)({
    params: Promise.resolve({ fileId }),
    searchParams: Promise.resolve({}),
  });
  if (!isValidElement(element)) {
    throw new Error('The page did not return a React element');
  }
  const guarded = element as ReactElement<{ children: ReactNode }>;
  expect(guarded.type).toBe(RouteGuard);
  return render(withProviders(guarded.props.children));
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

/** In-test back-end state, read on every request. */
let served: FileDetails;
let signedInRole: UserRole = 'Importer';
/** Answers POST /files/<id>/cancel for the open file. */
let answerCancel: () => Promise<FileDetails>;

function routeGet(endpoint: unknown): Promise<unknown> {
  const url = String(endpoint);
  const id = encodeURIComponent(served.id);
  if (url === `/files/${id}`) return Promise.resolve(served);
  if (url === `/files/${id}/invalid-rows`) {
    return Promise.resolve(seededInvalidRows(served.id));
  }
  if (url === '/auth/me') return Promise.resolve(userInfoFor(signedInRole));
  return Promise.reject({ message: 'Not found', statusCode: 404 });
}

function routePost(endpoint: unknown): Promise<unknown> {
  const url = String(endpoint);
  if (url === `/files/${encodeURIComponent(served.id)}/cancel`) {
    return answerCancel();
  }
  return Promise.reject({ message: 'Not found', statusCode: 404 });
}

describe('Epic file-correction-and-cancel, Story 3: cancel a file', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('EventSource', FakeEventSource);
    signedInRole = 'Importer';
    served = seeded('aprilBatch2');
    answerCancel = () =>
      Promise.reject({ message: 'Unexpected cancel', statusCode: 500 });
    mockGet.mockImplementation((endpoint: unknown) => routeGet(endpoint));
    mockApiClient.mockImplementation((endpoint: unknown) => routeGet(endpoint));
    mockPost.mockImplementation((endpoint: unknown) => routePost(endpoint));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // AC-1
  it('offers "Cancel file" to an Importer on any file that is not cancelled and on its correction screen, but not to an Approver or on a cancelled file', async () => {
    // Importer: offered whatever the status (Completed, Failed, Processing).
    for (const key of ['aprilBatch2', 'invalidRows', 'processing'] as const) {
      served = seeded(key);
      const view = renderDetails(served.id, 'Importer');
      expect(
        await screen.findByRole('heading', { level: 1, name: served.fileName }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /^cancel file$/i }),
      ).toBeInTheDocument();
      view.unmount();
    }

    // Approver: never offered.
    signedInRole = 'Approver';
    served = seeded('aprilBatch2');
    const approverView = renderDetails(served.id, 'Approver');
    expect(
      await screen.findByRole('heading', { level: 1, name: served.fileName }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /cancel file/i }),
    ).not.toBeInTheDocument();
    approverView.unmount();

    // A cancelled file: not offered, even to an Importer.
    signedInRole = 'Importer';
    served = seeded('cancelledCompleted');
    const cancelledView = renderDetails(served.id, 'Importer');
    expect(
      await screen.findByRole('heading', { level: 1, name: served.fileName }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /cancel file/i }),
    ).not.toBeInTheDocument();
    cancelledView.unmount();

    // The correction screen of a file waiting for corrections also offers it.
    served = seeded('invalidRows');
    await renderCorrections(served.id);
    expect(
      await screen.findByRole('button', { name: /^cancel file$/i }),
    ).toBeInTheDocument();
  });

  // AC-6
  it('shows progress and locks the confirmation while cancelling, offers "Try again" after a failure, and shows a file someone else already cancelled as cancelled with no problem', async () => {
    const user = userEvent.setup();
    const file = seeded('invalidRows');
    served = file;
    // Someone else cancelled it first: the idempotent 200 carries THEIR time and name.
    const cancelledEarlier = cancelledFileDetails(file, {
      now: '2026-05-03T09:41:00+02:00',
      cancelledBy: 'Second Importer',
    });

    // The first attempt hangs until we fail it as a network error.
    let failFirst: (reason: unknown) => void = () => {};
    answerCancel = () =>
      new Promise<FileDetails>((_resolve, reject) => {
        failFirst = reject;
      });

    renderDetails(file.id, 'Importer');
    await user.click(
      await screen.findByRole('button', { name: /^cancel file$/i }),
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: `Cancel ${file.fileName}?`,
    });
    await user.click(
      within(dialog).getByRole('button', { name: /^cancel file$/i }),
    );

    // In progress: shows progress, and neither button can be pressed again.
    const pending = await within(dialog).findByRole('button', {
      name: /cancelling/i,
    });
    expect(pending).toBeDisabled();
    expect(
      within(dialog).getByRole('button', { name: /keep file/i }),
    ).toBeDisabled();

    // A failed request: the dialog stays open with a problem and "Try again".
    failFirst({
      message: 'Network error',
      statusCode: 0,
      isNetworkError: true,
    });
    const problem = await within(dialog).findByRole('alert');
    const tryAgain = within(problem).getByRole('button', {
      name: /try again/i,
    });

    // Trying again gets the idempotent "already cancelled" answer.
    answerCancel = () => {
      served = cancelledEarlier;
      return Promise.resolve(cancelledEarlier);
    };
    await user.click(tryAgain);

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(
      await screen.findByText(
        new RegExp(
          `cancelled on ${localMinutes('2026-05-03T09:41:00+02:00')} by Second Importer`,
          'i',
        ),
      ),
    ).toBeInTheDocument();
    const notifications = screen.getByRole('region', {
      name: /notifications/i,
    });
    expect(within(notifications).queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /cancel file/i }),
    ).not.toBeInTheDocument();
  });
});
