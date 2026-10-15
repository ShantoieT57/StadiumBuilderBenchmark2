/**
 * Helpers for inspecting the errors thrown by `@/lib/api/client`.
 *
 * Kept separate from the client so callers can branch on an error even where
 * the client module itself is mocked.
 */
import type { APIError } from '@/types/api';

/** Proxy statuses that mean "the back-end could not be reached". */
export const UNREACHABLE_STATUSES: readonly number[] = [502, 503, 504];

/** True when `error` has the shape the API client throws. */
export function isAPIError(error: unknown): error is APIError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { message?: unknown }).message === 'string' &&
    'statusCode' in error
  );
}

/**
 * True when the request never got an answer from the back-end: fetch threw,
 * or the same-origin proxy answered 502-504. Distinct from any HTTP refusal
 * (e.g. a 401 for wrong credentials).
 */
export function isNetworkError(error: unknown): boolean {
  if (!isAPIError(error)) return false;
  return (
    error.isNetworkError === true ||
    error.statusCode === 0 ||
    UNREACHABLE_STATUSES.includes(error.statusCode ?? -1)
  );
}

/** The HTTP status of an API error, or undefined for anything else. */
export function statusOf(error: unknown): number | undefined {
  return isAPIError(error) ? error.statusCode : undefined;
}
