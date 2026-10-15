/**
 * Server-side session gate for signed-in pages (BR3 / NFR-1). SERVER ONLY.
 *
 * Asks the back-end who is signed in (`currentSession`, one `GET /auth/me` per
 * server request) and redirects anyone not signed in to sign-in with the 401
 * `reason` before anything renders. Used by the `(authenticated)` layout, the
 * per-screen `RouteGuard` and the `/` landing redirect.
 */
import { redirect } from 'next/navigation';

import { currentSession, signInPathFor } from '@/lib/server/session';
import type { CurrentUser } from '@/types/api-generated';

/** The signed-in person; never returns for anyone else (redirects to sign-in). */
export async function requireSession(): Promise<CurrentUser> {
  const session = await currentSession();
  if (session.status !== 'signed-in') {
    redirect(signInPathFor(session));
  }
  return session.user;
}
