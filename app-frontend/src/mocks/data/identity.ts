/**
 * Project-wide mock identity source - the single place both Vitest and Playwright
 * get auth-related response bodies from. Never inline these bodies in specs.
 *
 * Imports are type-only / relative so Playwright can load this without `@/` aliases.
 */
import type {
  CurrentUser,
  ErrorResponse,
  SessionEndedEvent,
  UnauthenticatedReason,
  UnauthenticatedResponse,
  UserRole,
} from '../../types/api-generated';
import { createCurrentUser } from './currentUser';

/** The two seeded users, keyed by role. */
export const seededUsers: Record<UserRole, CurrentUser> = {
  Importer: createCurrentUser({
    name: 'File Importer',
    email: 'fileimporter@digiata.com',
    role: 'Importer',
  }),
  Approver: createCurrentUser({
    name: 'Approver User',
    email: 'approver@digiata.com',
    role: 'Approver',
  }),
};

/** GET /auth/me body for the seeded user holding `role`. Returns a fresh copy. */
export function userInfoFor(role: UserRole): CurrentUser {
  return { ...seededUsers[role] };
}

/** The exact 401 message the backend sends for each reason. */
export const unauthenticatedMessages: Record<UnauthenticatedReason, string> = {
  NotSignedIn: 'You are not signed in.',
  SessionExpired:
    'Your session has expired after 60 minutes of inactivity. Please sign in again.',
  SignedInElsewhere:
    'You have been signed out because you signed in somewhere else.',
  SignedOut: 'You have been signed out. Please sign in again.',
};

/** 401 body `{ message, reason }` for the given reason. */
export function unauthenticatedBody(
  reason: UnauthenticatedReason,
): UnauthenticatedResponse {
  return { message: unauthenticatedMessages[reason], reason };
}

/** The exact message of a failed sign-in (POST /auth/sign-in 401). */
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

/** Failed sign-in body `{ message }`. */
export function signInFailureBody(): ErrorResponse {
  return { message: INVALID_CREDENTIALS_MESSAGE };
}

/** `data` payload of a `session-ended` SSE event for the given reason. */
export function sessionEndedEvent(
  reason: UnauthenticatedReason,
): SessionEndedEvent {
  return { message: unauthenticatedMessages[reason], reason };
}

/** A complete `session-ended` SSE frame (event + data lines, blank-line terminated). */
export function sessionEndedFrame(reason: UnauthenticatedReason): string {
  return `event: session-ended\ndata: ${JSON.stringify(sessionEndedEvent(reason))}\n\n`;
}
