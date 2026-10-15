/**
 * Story Metadata:
 * - Route: /sign-in
 * - Target File: app-frontend/src/app/sign-in/page.tsx (renders the client component below)
 * - Component under test: app-frontend/src/components/auth/SignInForm.tsx (named export `SignInForm`)
 * - Page Action: create_new
 *
 * Tests for Epic sign-in-and-app-shell, Story 1: the sign-in form.
 *
 * Contract these tests assume (the developer implements to it):
 * - `SignInForm` is a client component that renders the whole sign-in card: the
 *   Email and Password fields, the "Sign in" button, the forgotten-password
 *   guidance and the privacy-notice link to /privacy.
 * - It signs in through `signIn` from `@/lib/api/endpoints` (which calls `post`
 *   from `@/lib/api/client` — the only module mocked here).
 * - Field errors are linked to their input via `aria-describedby` (NFR-4), so
 *   they are the input's accessible description.
 * - The client rejects with an API error object carrying `statusCode`:
 *   401 for wrong credentials (body `{ message: 'Invalid email or password' }`),
 *   0 for a network failure / unreachable back-end (the client's existing
 *   network-error shape; the proxy's 502-504 must map to the same thing).
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SignInForm } from '@/components/auth/SignInForm';
import { post } from '@/lib/api/client';
import {
  INVALID_CREDENTIALS_MESSAGE,
  signInFailureBody,
} from '@/mocks/data/identity';

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/sign-in',
  useSearchParams: () => new URLSearchParams(),
}));

const mockPost = post as ReturnType<typeof vi.fn>;

/** Wrong credentials: what the client throws for POST /auth/sign-in -> 401. */
function invalidCredentialsError() {
  return {
    message: INVALID_CREDENTIALS_MESSAGE,
    statusCode: 401,
    details: [INVALID_CREDENTIALS_MESSAGE],
    endpoint: '/api/auth/sign-in',
    body: signInFailureBody(),
  };
}

/** Unreachable back-end: the client's network-failure error (statusCode 0). */
function networkError() {
  return {
    message: 'Network error: Unable to connect to the API server',
    statusCode: 0,
    details: ['Please check your internet connection and try again.'],
    endpoint: '/api/auth/sign-in',
  };
}

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^email/i), email);
  await user.type(screen.getByLabelText(/^password/i), password);
  await user.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('Epic sign-in-and-app-shell, Story 1: sign-in form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-1
  it('marks both fields required and checks them on leaving a field and on submit, not while typing', async () => {
    const user = userEvent.setup();
    render(<SignInForm />);

    const email = screen.getByLabelText(/^email/i);
    const password = screen.getByLabelText(/^password/i);
    expect(email).toBeRequired();
    expect(password).toBeRequired();

    // Typing and clearing while still in the field shows nothing yet.
    await user.click(password);
    await user.type(password, 'T');
    await user.clear(password);
    expect(password).not.toHaveAccessibleDescription(/required/i);

    // Leaving the empty field flags it.
    await user.click(email);
    await waitFor(() => {
      expect(password).toHaveAccessibleDescription(/required/i);
    });
    expect(email).not.toHaveAccessibleDescription(/required/i);

    // Submitting with both empty flags both.
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => {
      expect(email).toHaveAccessibleDescription(/required/i);
    });
    expect(password).toHaveAccessibleDescription(/required/i);
  });

  // AC-2
  it('shows exactly "Invalid email or password" when the credentials are wrong', async () => {
    mockPost.mockRejectedValue(invalidCredentialsError());
    render(<SignInForm />);

    await fillAndSubmit('fileimporter@digiata.com', 'WrongPassword1');

    expect(
      await screen.findByText(INVALID_CREDENTIALS_MESSAGE),
    ).toBeInTheDocument();
  });

  // AC-3
  it('shows a connection-problem message, not the wrong-credentials message, when the app cannot be reached', async () => {
    mockPost.mockRejectedValue(networkError());
    render(<SignInForm />);

    await fillAndSubmit('fileimporter@digiata.com', 'Test123');

    expect(
      await screen.findByText(/(can't|can’t|cannot) reach the app/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(INVALID_CREDENTIALS_MESSAGE),
    ).not.toBeInTheDocument();
  });

  // AC-4
  it('tells a person who forgot their password to contact their administrator and links to the privacy notice', () => {
    render(<SignInForm />);

    expect(
      screen.getByText('Forgotten your password? Contact your administrator.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /privacy/i })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });
});
