/**
 * Where a person goes when the back-end says they are not signed in, shared by
 * the server-side session gate, the API client's central 401 handler and the
 * live connection's `session-ended` handler, so all three agree (BR4).
 */
import type { UnauthenticatedReason } from '@/types/api-generated';

export const SIGN_IN_PATH = '/sign-in';

const REASONS: readonly UnauthenticatedReason[] = [
  'NotSignedIn',
  'SessionExpired',
  'SignedInElsewhere',
  'SignedOut',
];

/** A known `UnauthenticatedReason`, or `NotSignedIn` for anything else. */
export function toUnauthenticatedReason(value: unknown): UnauthenticatedReason {
  return REASONS.find((known) => known === value) ?? 'NotSignedIn';
}

/**
 * The sign-in path for a 401 `reason`. A reason other than `NotSignedIn`
 * travels as `?reason=` so the sign-in screen can explain it.
 */
export function signInPathForReason(reason: unknown): string {
  const known = toUnauthenticatedReason(reason);
  return known === 'NotSignedIn'
    ? SIGN_IN_PATH
    : `${SIGN_IN_PATH}?reason=${known}`;
}

/**
 * Leaves the app for the sign-in screen with a full page load, so nothing of
 * the signed-in session stays in memory or in the client router cache.
 * Does nothing outside a browser or when already on the sign-in screen.
 *
 * @returns true when the page is now leaving for sign-in.
 */
export function redirectToSignIn(reason: unknown): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location.pathname === SIGN_IN_PATH) return false;
  window.location.assign(signInPathForReason(reason));
  return true;
}
