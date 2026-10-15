/**
 * Authorization guard for the same-origin `/api` proxy. SERVER ONLY.
 *
 * A proxied call to a signed-in endpoint must carry the `txn_session` cookie;
 * one without it is refused here with the back-end's own 401 shape
 * (`reason: NotSignedIn`) and never reaches the back-end.
 *
 * Presence only: the back-end stays the authority on whether the session is
 * valid. Deliberately no `GET /auth/me` per call — that would count as session
 * activity (defeating the 60-minute idle timeout) and add a round trip.
 */
import type { NextRequest } from 'next/server';

import { SESSION_COOKIE } from '@/lib/server/backend';
import type { UnauthenticatedResponse } from '@/types/api-generated';

const NOT_SIGNED_IN: UnauthenticatedResponse = {
  message: 'You are not signed in.',
  reason: 'NotSignedIn',
};

/**
 * `null` when the request may go on to the back-end; otherwise the 401
 * response to send instead.
 */
export function requireAuth(request: NextRequest): Response | null {
  if (request.cookies.get(SESSION_COOKIE)?.value) {
    return null;
  }
  return Response.json(NOT_SIGNED_IN, { status: 401 });
}
