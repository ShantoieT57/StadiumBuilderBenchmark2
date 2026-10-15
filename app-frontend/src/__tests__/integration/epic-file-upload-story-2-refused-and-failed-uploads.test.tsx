/**
 * Story Metadata:
 * - Route: /upload
 * - Target File: app-frontend/src/app/(authenticated)/upload/page.tsx
 * - Page Action: modify_existing
 *
 * Tests for Epic file-upload, Story 2: refused files and failed uploads. Vitest
 * covers AC-2 (invalid file names refused before uploading), AC-4 (server refusals
 * shown word for word, kept until another file is chosen) and AC-6 (refusal and
 * failure messages announced and tied to the file field). AC-1, AC-3 and AC-5 are
 * Playwright.
 *
 * Render scope: through the page module, as Story 1 builds it (in parallel). The
 * signed-in page is a server component whose `RouteGuard` (async, server-only
 * session check) jsdom cannot render, so each test calls the page's default export,
 * checks it wraps its content in `<RouteGuard route="/upload">`, and renders that
 * content inside the toast providers the root layout mounts. Implementation
 * contract these tests assume:
 * - The page default export returns `<RouteGuard route="/upload">` as its
 *   OUTERMOST element, whose children are the client upload form (Story 1 suggests
 *   `UploadForm` in `@/components/upload/UploadForm`; no component name is assumed).
 * - The form has exactly one `<input type="file">` (the visually hidden input the
 *   "Choose file" button drives) and a button named exactly "Upload".
 * - The upload goes through `uploadFile(file, kind, options)` from
 *   `@/lib/api/upload` (Story 1's XMLHttpRequest uploader; the `endpoints.ts`
 *   re-export resolves to the same mocked module). The uploader is mocked at that
 *   module boundary - the XHR transport is Story 1's own concern. On failure it
 *   rejects with the API client's `APIError` shape (statusCode, message, errors,
 *   body; statusCode 0 + `isNetworkError` for a dropped connection).
 * - Client pre-checks (`@/lib/validation/upload`) run when a file is chosen: a name
 *   over 255 characters or containing `..`, `\` or `:` is refused with exactly
 *   "Invalid file name" and nothing is uploaded.
 * - Refusals and failures are shown inline (NOT as a toast) in a `role="alert"`
 *   element under the file field, whose id is referenced by the file input's
 *   `aria-describedby` (so it is the input's accessible description).
 * - 400 `{ message }` / 403 / 413 / 415: the error's `message` verbatim. 400
 *   ValidationProblem: every value of `errors` verbatim.
 * - Network failure: "The upload of <file name> failed. Check your connection and
 *   try again."
 *
 * Data-contract: the uploader is mocked; the real XHR -> proxy -> back-end chain is
 * verified by the Playwright spec and the manual checklist.
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Will fail until implemented (TDD red)
import UploadPage from '@/app/(authenticated)/upload/page';
import { RouteGuard } from '@/components/shell/RouteGuard';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { ToastProvider } from '@/contexts/ToastContext';
// Will fail until implemented (TDD red) - Story 1's XHR uploader
import { uploadFile } from '@/lib/api/upload';
// Project-wide mock data shared with the Playwright layer (never re-defined here).
import { FORBIDDEN_MESSAGE } from '@/mocks/data/identity';
import {
  FILE_REQUIRED_MESSAGE,
  FILE_TOO_LARGE_MESSAGE,
  INVALID_FILE_NAME_MESSAGE,
  NOT_MULTIPART_MESSAGE,
  UPLOADED_FILE_NAME,
} from '@/mocks/data/uploads';
import type { APIError } from '@/types/api';

vi.mock('@/lib/api/upload', () => ({ uploadFile: vi.fn() }));

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

const mockUploadFile = uploadFile as ReturnType<typeof vi.fn>;

/**
 * Calls the upload page's default export, checks it is guarded by
 * `<RouteGuard route="/upload">`, and renders the guarded content inside the
 * providers the real root layout mounts.
 */
async function renderUploadPage(): Promise<void> {
  const element = await (
    UploadPage as unknown as () => ReactNode | Promise<ReactNode>
  )();
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

/** The form's single file input (no ARIA role exists for file inputs). */
function fileInput(): HTMLInputElement {
  const inputs =
    document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  expect(inputs).toHaveLength(1);
  return inputs[0];
}

/** A small CSV file named `name` (contents are never read or shown). */
function csvFile(name: string): File {
  return new File(['Date,Reference,Amount\n'], name, { type: 'text/csv' });
}

/**
 * The single inline alert carrying `message` - outside the shared Notifications
 * (toast) region, so it never auto-dismisses.
 */
async function findFieldAlert(message: string): Promise<HTMLElement> {
  let found: HTMLElement[] = [];
  await waitFor(() => {
    found = screen
      .getAllByRole('alert')
      .filter((alert) => alert.textContent?.includes(message) === true);
    expect(found).toHaveLength(1);
  });
  const notifications = screen.getByRole('region', { name: 'Notifications' });
  expect(notifications).not.toContainElement(found[0]);
  return found[0];
}

/** An `APIError` as the uploader rejects with it. */
function refusal(
  statusCode: number,
  message: string,
  extra: Partial<APIError> = {},
): APIError {
  return {
    message,
    statusCode,
    details: [message],
    endpoint: '/files',
    body: { message },
    ...extra,
  };
}

describe('Epic file-upload, Story 2: refused files and failed uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-2
  it('refuses a too-long or badly named .csv file with "Invalid file name" without uploading it', async () => {
    const user = userEvent.setup();
    await renderUploadPage();

    const badNames = [
      `${'a'.repeat(252)}.csv`, // 256 characters
      'transactions..2026-04-15.csv',
      'C:transactions_2026-04-15.csv',
      'folder\\transactions_2026-04-15.csv',
    ];

    for (const badName of badNames) {
      // A good file first, so each refusal below is raised afresh by the bad name.
      await user.upload(fileInput(), csvFile(UPLOADED_FILE_NAME));
      expect(screen.getByText(UPLOADED_FILE_NAME)).toBeInTheDocument();
      expect(
        screen.queryByText(INVALID_FILE_NAME_MESSAGE),
      ).not.toBeInTheDocument();

      await user.upload(fileInput(), csvFile(badName));
      await findFieldAlert(INVALID_FILE_NAME_MESSAGE);
    }

    // The refused file was cleared, so Upload sends nothing.
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(screen.queryByText(/^Uploading /)).not.toBeInTheDocument();
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  // AC-4
  it("shows the server's refusal word for word and keeps it until another file is chosen", async () => {
    const user = userEvent.setup();
    await renderUploadPage();

    const serverRefusals: { error: APIError; shown: string }[] = [
      {
        error: refusal(413, FILE_TOO_LARGE_MESSAGE),
        shown: FILE_TOO_LARGE_MESSAGE,
      },
      {
        error: refusal(415, NOT_MULTIPART_MESSAGE),
        shown: NOT_MULTIPART_MESSAGE,
      },
      {
        error: refusal(400, 'One or more validation errors occurred.', {
          errors: { file: [FILE_REQUIRED_MESSAGE] },
          body: {
            title: 'One or more validation errors occurred.',
            status: 400,
            errors: { file: [FILE_REQUIRED_MESSAGE] },
          },
        }),
        shown: FILE_REQUIRED_MESSAGE,
      },
      {
        error: refusal(403, FORBIDDEN_MESSAGE),
        shown: FORBIDDEN_MESSAGE,
      },
    ];

    for (const { error, shown } of serverRefusals) {
      mockUploadFile.mockRejectedValueOnce(error);

      await user.upload(fileInput(), csvFile(UPLOADED_FILE_NAME));
      await user.click(screen.getByRole('button', { name: 'Upload' }));
      await findFieldAlert(shown);

      // Still on screen once the upload has settled (inline, not a self-closing message).
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled();
      });
      expect(await findFieldAlert(shown)).toHaveTextContent(shown);

      // Choosing another file withdraws it.
      await user.upload(fileInput(), csvFile(UPLOADED_FILE_NAME));
      expect(screen.queryByText(shown)).not.toBeInTheDocument();
    }
  });

  // AC-6
  it('announces a refusal and a failed upload and ties each to the file field', async () => {
    const user = userEvent.setup();
    await renderUploadPage();

    // Client refusal.
    await user.upload(fileInput(), csvFile('transactions..2026-04-15.csv'));
    await findFieldAlert(INVALID_FILE_NAME_MESSAGE);
    expect(fileInput()).toHaveAccessibleDescription(
      expect.stringContaining(INVALID_FILE_NAME_MESSAGE),
    );

    // Connection dropped part way.
    mockUploadFile.mockRejectedValueOnce({
      message: 'Network error: Unable to connect to the API server',
      statusCode: 0,
      details: ['Please check your internet connection and try again.'],
      endpoint: '/files',
      isNetworkError: true,
    } satisfies APIError);
    const failedMessage = `The upload of ${UPLOADED_FILE_NAME} failed. Check your connection and try again.`;

    await user.upload(fileInput(), csvFile(UPLOADED_FILE_NAME));
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await findFieldAlert(failedMessage)).toHaveTextContent(
      failedMessage,
    );
    expect(fileInput()).toHaveAccessibleDescription(
      expect.stringContaining(failedMessage),
    );
    expect(fileInput()).not.toHaveAccessibleDescription(
      expect.stringContaining(INVALID_FILE_NAME_MESSAGE),
    );
  });
});
