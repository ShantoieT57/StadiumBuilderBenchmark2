/**
 * Server-side session check behind `requireSession` (BR3 / NFR-1).
 * SERVER ONLY: uses `next/headers`.
 *
 * Calls `GET ${BACKEND_URL}/auth/me` with the incoming `txn_session` cookie.
 * Every /auth/me call counts as session activity at the back-end, so this runs
 * only on real navigation, never on a timer.
 */
import { cookies } from 'next/headers';
import { cache } from 'react';

import {
  SIGN_IN_PATH,
  signInPathForReason,
  toUnauthenticatedReason,
} from '@/lib/auth/signIn';
import { backendUrl, SESSION_COOKIE } from '@/lib/server/backend';
import type { CurrentUser, UnauthenticatedReason } from '@/types/api-generated';

export type SessionCheck =
  | { status: 'signed-in'; user: CurrentUser }
  | { status: 'signed-out'; reason: UnauthenticatedReason }
  | { status: 'unavailable' };

function reasonFrom(body: unknown): UnauthenticatedReason {
  return toUnauthenticatedReason((body as { reason?: unknown } | null)?.reason);
}

/** Who is signed in for the current request, according to the back-end. */
export async function checkSession(): Promise<SessionCheck> {
  const session = (await cookies()).get(SESSION_COOKIE);
  if (!session?.value) {
    return { status: 'signed-out', reason: 'NotSignedIn' };
  }

  let response: Response;
  try {
    response = await fetch(`${backendUrl()}/auth/me`, {
      headers: {
        accept: 'application/json',
        cookie: `${SESSION_COOKIE}=${session.value}`,
      },
      cache: 'no-store',
    });
  } catch {
    return { status: 'unavailable' };
  }

  if (response.ok) {
    return {
      status: 'signed-in',
      user: (await response.json()) as CurrentUser,
    };
  }
  if (response.status === 401) {
    const body: unknown = await response.json().catch(() => null);
    return { status: 'signed-out', reason: reasonFrom(body) };
  }
  return { status: 'unavailable' };
}

/**
 * `checkSession`, de-duplicated per server request: the signed-in layout and
 * the page's route guard share one `GET /auth/me` instead of making two.
 */
export const currentSession = cache(checkSession);

/**
 * Where to send a person who is not signed in. A reason other than
 * `NotSignedIn` travels as `?reason=` so the sign-in screen can explain it.
 */
export function signInPathFor(
  check: Exclude<SessionCheck, { status: 'signed-in' }>,
): string {
  return check.status === 'signed-out'
    ? signInPathForReason(check.reason)
    : SIGN_IN_PATH;
}
