/**
 * Story Metadata:
 * - Route: /upload
 * - Target File: app-frontend/src/app/(authenticated)/upload/page.tsx
 * - Page Action: modify_existing
 *
 * Tests for Epic file-upload, Story 1: upload a file with progress and confirmation.
 * Vitest covers AC-1 and AC-3 (AC-2, AC-4 and AC-6 are Playwright; AC-5 is none).
 *
 * Render scope: through the page module. The page is a server component whose
 * `RouteGuard` (async, server-only session check) jsdom cannot render, so the test
 * calls the page's default export, checks it wraps its content in
 * `<RouteGuard route="/upload">`, and renders that content inside the providers the
 * real layouts mount (ToastProvider + ToastContainer).
 *
 * Transport: the REAL `uploadFile(file, kind, { onProgress, signal })` from
 * `@/lib/api/upload` runs; jsdom's `XMLHttpRequest` is replaced by an in-test fake so
 * the test drives upload progress and the 201 answer. Nothing in the code under test
 * is mocked.
 *
 * Implementation contract these tests assume (Story 2 builds on the same form):
 * - Page default export returns `<RouteGuard route="/upload">` as its OUTERMOST
 *   element; its children are the client form (`UploadForm` from
 *   `@/components/upload/UploadForm`, no required props). No `<main>`.
 * - `uploadFile` (lib/api/upload.ts, re-exported from endpoints.ts) sends
 *   `xhr.open('POST', '/api/files')` (`${API_BASE_URL}/files`) and `xhr.send(FormData)`
 *   with fields `file` (the File) and `kind` = `BankTransactions`; reports progress
 *   from `xhr.upload` `progress` events (`onprogress` property or addEventListener)
 *   as a whole-number percentage; resolves with the parsed `UploadedFile` on 201
 *   (reads `responseText`, or `response` when `responseType = 'json'`).
 * - File field: a visually hidden `<input type="file" accept=".csv" required>` labelled
 *   "File to upload" (visible label text "File to upload" followed by a `*`), driven
 *   by a "Choose file" button, inside a drop area whose text says to drag a file here
 *   (e.g. "Drag a file here"). The `<form>` is `noValidate`; selecting the "Upload"
 *   button with no file shows "Choose a file to upload." and sends nothing.
 * - Kind: shadcn Select (combobox) labelled "Kind of file" (visible label followed by
 *   a `*`), `required` (Radix sets `aria-required`), showing "Bank transactions".
 * - While uploading (inside the upload `<form>`): a `role="progressbar"` (shadcn Progress, `aria-valuenow` = the
 *   percentage), the percentage as visible text (e.g. "40%"), "Uploading <file name>…"
 *   text; the "Choose file" button, the file input, the Kind combobox and the
 *   "Upload" button are disabled until the upload ends.
 * - The form's own `role="status"` live region (NOT the toast inside the
 *   "Notifications" region) names the file when the upload starts (contains
 *   "Uploading" + file name) and again when it finishes (contains the file name and
 *   "uploaded").
 * - Success: the shared success toast "<file name> has been uploaded successfully.",
 *   then the form is usable again.
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Will fail until implemented (TDD red)
import UploadPage from '@/app/(authenticated)/upload/page';
import { RouteGuard } from '@/components/shell/RouteGuard';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { ToastProvider } from '@/contexts/ToastContext';
// Project-wide mock data shared with the Playwright layer (never re-defined here).
import { UPLOADED_FILE_NAME, createUploadedFile } from '@/mocks/data/uploads';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => '/upload',
  useSearchParams: () => new URLSearchParams(),
}));

type Handler = ((event: Event) => void) | null;

/** `xhr.upload`: progress events, by property or listener. */
class FakeUpload extends EventTarget {
  onprogress: Handler = null;
  onloadstart: Handler = null;
  onload: Handler = null;
  onloadend: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
}

/** Stand-in for the browser XMLHttpRequest, driven by the test. */
class FakeXMLHttpRequest extends EventTarget {
  static readonly UNSENT = 0;
  static readonly OPENED = 1;
  static readonly HEADERS_RECEIVED = 2;
  static readonly LOADING = 3;
  static readonly DONE = 4;
  static requests: FakeXMLHttpRequest[] = [];

  readonly UNSENT = 0;
  readonly OPENED = 1;
  readonly HEADERS_RECEIVED = 2;
  readonly LOADING = 3;
  readonly DONE = 4;

  readonly upload = new FakeUpload();
  method = '';
  url = '';
  body: unknown = undefined;
  readyState = 0;
  status = 0;
  statusText = '';
  responseType: XMLHttpRequestResponseType = '';
  responseText = '';
  response: unknown = '';
  withCredentials = false;
  timeout = 0;
  aborted = false;
  private responseHeaders: Record<string, string> = {};

  onreadystatechange: Handler = null;
  onloadstart: Handler = null;
  onprogress: Handler = null;
  onload: Handler = null;
  onloadend: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  ontimeout: Handler = null;

  constructor() {
    super();
    FakeXMLHttpRequest.requests.push(this);
  }

  open(method: string, url: string | URL): void {
    this.method = method.toUpperCase();
    this.url = String(url);
    this.readyState = 1;
  }

  setRequestHeader(): void {}

  overrideMimeType(): void {}

  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name.toLowerCase()] ?? null;
  }

  getAllResponseHeaders(): string {
    return Object.entries(this.responseHeaders)
      .map(([key, value]) => `${key}: ${value}\r\n`)
      .join('');
  }

  send(body?: unknown): void {
    this.body = body;
  }

  abort(): void {
    this.aborted = true;
  }

  /** Fires `type` on `target`, through both its `on<type>` property and listeners. */
  private static fire(target: EventTarget, event: Event): void {
    const handler = (target as unknown as Record<string, Handler>)[
      `on${event.type}`
    ];
    if (typeof handler === 'function') handler.call(target, event);
    target.dispatchEvent(event);
  }

  /** The browser reporting `loaded` of `total` bytes sent. */
  progress(loaded: number, total: number): void {
    FakeXMLHttpRequest.fire(
      this.upload,
      new ProgressEvent('progress', { lengthComputable: true, loaded, total }),
    );
  }

  /** The server answering with `status` and a JSON body. */
  respond(status: number, body: unknown): void {
    const text = JSON.stringify(body);
    this.status = status;
    this.statusText = status === 201 ? 'Created' : '';
    this.responseHeaders = { 'content-type': 'application/json' };
    this.responseText = this.responseType === 'json' ? '' : text;
    this.response = this.responseType === 'json' ? body : text;
    this.readyState = 4;
    FakeXMLHttpRequest.fire(this, new Event('readystatechange'));
    FakeXMLHttpRequest.fire(this, new ProgressEvent('load'));
    FakeXMLHttpRequest.fire(this, new ProgressEvent('loadend'));
  }

  /** The server answering with `status` and a raw (possibly empty, non-JSON) body. */
  respondWithText(status: number, text: string): void {
    this.status = status;
    this.statusText = status === 201 ? 'Created' : '';
    this.responseHeaders = text === '' ? {} : { 'content-type': 'text/plain' };
    this.responseText = this.responseType === 'json' ? '' : text;
    this.response = this.responseType === 'json' ? null : text;
    this.readyState = 4;
    FakeXMLHttpRequest.fire(this, new Event('readystatechange'));
    FakeXMLHttpRequest.fire(this, new ProgressEvent('load'));
    FakeXMLHttpRequest.fire(this, new ProgressEvent('loadend'));
  }
}

/** Next page props, loose enough for the page's signature. */
type PageModule = (props: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string>>;
}) => ReactNode | Promise<ReactNode>;

/**
 * Calls the upload page's default export, checks it is guarded by
 * `<RouteGuard route="/upload">`, and renders the guarded content inside the
 * providers the real layouts mount.
 */
async function renderUploadPage(): Promise<void> {
  const element = await (UploadPage as unknown as PageModule)({
    params: Promise.resolve({}),
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
  expect(guarded.props.route).toBe('/upload');
  render(
    <ToastProvider>
      {guarded.props.children}
      <ToastContainer />
    </ToastProvider>,
  );
}

/** The form's own live region (not a toast inside the "Notifications" region). */
function formStatus(): HTMLElement {
  const notifications = screen.queryByRole('region', { name: 'Notifications' });
  const own = screen
    .getAllByRole('status')
    .filter((element) => !notifications?.contains(element));
  expect(own).toHaveLength(1);
  return own[0];
}

/** The upload request the form sent (waits until it has been sent). */
async function sentRequest(): Promise<FakeXMLHttpRequest> {
  await waitFor(() =>
    expect(FakeXMLHttpRequest.requests.at(-1)?.body).toBeInstanceOf(FormData),
  );
  const xhr = FakeXMLHttpRequest.requests.at(-1);
  if (!xhr) throw new Error('No upload request was sent');
  return xhr;
}

describe('Epic file-upload, Story 1: upload a file with progress and confirmation', () => {
  beforeEach(() => {
    FakeXMLHttpRequest.requests = [];
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // AC-1
  it('shows the drop area, Choose file and Bank transactions as required fields, and asks for a file when Upload is selected without one', async () => {
    const user = userEvent.setup();
    await renderUploadPage();

    expect(screen.getByText(/drag .*file.* here/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose file' }),
    ).toBeInTheDocument();

    const fileInput = screen.getByLabelText(/file to upload/i, {
      selector: 'input[type="file"]',
    });
    expect(fileInput).toBeRequired();
    expect(screen.getByText(/file to upload/i).textContent).toContain('*');

    const kind = screen.getByRole('combobox', { name: /kind of file/i });
    expect(kind).toHaveTextContent('Bank transactions');
    expect(kind).toBeRequired();
    expect(screen.getByText(/kind of file/i).textContent).toContain('*');

    await user.click(screen.getByRole('button', { name: 'Upload' }));

    expect(
      await screen.findByText('Choose a file to upload.'),
    ).toBeInTheDocument();
  });

  // AC-3
  it('shows progress as a bar and a percentage, announces the start and finish, and locks the controls until the upload ends', async () => {
    const user = userEvent.setup();
    await renderUploadPage();

    const file = new File(['ignored'], UPLOADED_FILE_NAME, {
      type: 'text/csv',
    });
    await user.upload(
      screen.getByLabelText(/file to upload/i, {
        selector: 'input[type="file"]',
      }),
      file,
    );
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    // The upload went to the same-origin proxy as multipart with file + kind.
    const xhr = await sentRequest();
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/files');
    const sent = xhr.body as FormData;
    expect((sent.get('file') as File).name).toBe(UPLOADED_FILE_NAME);
    expect(sent.get('kind')).toBe('BankTransactions');

    // Start announced; controls locked.
    await waitFor(() =>
      expect(formStatus()).toHaveTextContent(
        new RegExp(
          `uploading.*${UPLOADED_FILE_NAME.replace(/\./g, '\\.')}`,
          'i',
        ),
      ),
    );
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeDisabled();
    expect(
      screen.getByLabelText(/file to upload/i, {
        selector: 'input[type="file"]',
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole('combobox', { name: /kind of file/i }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();

    // Progress as a bar and a percentage.
    act(() => xhr.progress(40, 100));
    const bar = await screen.findByRole('progressbar');
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '40'));
    const form = bar.closest('form');
    if (!form)
      throw new Error('The progress bar is not inside the upload form');
    expect(within(form).getByText('40%')).toBeInTheDocument();

    // Finished: confirmed, announced, controls usable again.
    act(() => xhr.respond(201, createUploadedFile()));

    const notifications = screen.getByRole('region', { name: 'Notifications' });
    expect(
      await within(notifications).findByText(
        `${UPLOADED_FILE_NAME} has been uploaded successfully.`,
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(formStatus()).toHaveTextContent(/uploaded/i));
    expect(formStatus()).toHaveTextContent(UPLOADED_FILE_NAME);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose file' }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole('combobox', { name: /kind of file/i }),
    ).not.toBeDisabled();
  });

  // Code review: any 2xx means the file is stored, even without a readable body.
  it('confirms the upload when the server answers 201 with an empty body, without offering Try again or a details link', async () => {
    const user = userEvent.setup();
    await renderUploadPage();

    await user.upload(
      screen.getByLabelText(/file to upload/i, {
        selector: 'input[type="file"]',
      }),
      new File(['ignored'], UPLOADED_FILE_NAME, { type: 'text/csv' }),
    );
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    const xhr = await sentRequest();
    act(() => xhr.respondWithText(201, ''));

    const notifications = screen.getByRole('region', { name: 'Notifications' });
    expect(
      await within(notifications).findByText(
        `${UPLOADED_FILE_NAME} has been uploaded successfully.`,
      ),
    ).toBeInTheDocument();

    const lastUpload = screen.getByRole('region', { name: 'Last upload' });
    expect(
      within(lastUpload).getByText(UPLOADED_FILE_NAME),
    ).toBeInTheDocument();
    expect(
      within(lastUpload).getByRole('link', { name: 'Go to dashboard' }),
    ).toBeInTheDocument();
    expect(
      within(lastUpload).queryByRole('link', { name: 'View file details' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
  });
});
