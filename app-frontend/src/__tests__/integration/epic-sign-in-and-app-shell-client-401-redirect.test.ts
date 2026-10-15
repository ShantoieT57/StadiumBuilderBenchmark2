/**
 * The API client's central 401 handler (Story 4, BR4): a 401 on a signed-in
 * call sends the page to sign-in, and the thrown error says so, so catch paths
 * can stay quiet instead of flashing a problem message during the page load.
 *
 * jsdom cannot leave the page, so the navigation is observed at
 * `redirectToSignIn`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { get } from '@/lib/api/client';
import { isNetworkError, isRedirectingToSignIn } from '@/lib/api/errors';
import { redirectToSignIn } from '@/lib/auth/signIn';
import { unauthenticatedBody } from '@/mocks/data/identity';

vi.mock('@/lib/auth/signIn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/signIn')>()),
  redirectToSignIn: vi.fn(() => true),
}));

const backend = vi.fn<typeof fetch>();

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('API client: ended session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', backend);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the page to sign-in with the reason and marks the error as redirecting', async () => {
    backend.mockResolvedValueOnce(
      answer(401, unauthenticatedBody('SignedInElsewhere')),
    );

    const error = await get('/transactions').catch((e: unknown) => e);

    expect(redirectToSignIn).toHaveBeenCalledWith('SignedInElsewhere');
    expect(isRedirectingToSignIn(error)).toBe(true);
    expect(isNetworkError(error)).toBe(false);
  });

  it('does not mark the error when the page is not leaving (already on sign-in)', async () => {
    vi.mocked(redirectToSignIn).mockReturnValueOnce(false);
    backend.mockResolvedValueOnce(
      answer(401, unauthenticatedBody('SessionExpired')),
    );

    const error = await get('/transactions').catch((e: unknown) => e);

    expect(isRedirectingToSignIn(error)).toBe(false);
  });

  it('leaves a 401 from the auth endpoints to the caller', async () => {
    backend.mockResolvedValueOnce(
      answer(401, unauthenticatedBody('SessionExpired')),
    );

    const error = await get('/auth/me').catch((e: unknown) => e);

    expect(redirectToSignIn).not.toHaveBeenCalled();
    expect(isRedirectingToSignIn(error)).toBe(false);
  });

  it('does not mark other refusals', async () => {
    backend.mockResolvedValueOnce(answer(403, { message: 'Not allowed.' }));

    const error = await get('/transactions').catch((e: unknown) => e);

    expect(isRedirectingToSignIn(error)).toBe(false);
  });
});
