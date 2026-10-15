/**
 * Server-side back-end location. SERVER ONLY: import from route handlers and
 * server components, never from client components.
 *
 * `BACKEND_URL` is read at request time (not inlined at build), so the same
 * build can point at the dev back-end, the E2E mock back-end, or production.
 * It is deliberately not a NEXT_PUBLIC_* variable: the browser only ever calls
 * the same-origin `/api` proxy.
 */

/** The back-end's session cookie (HttpOnly, browser-managed). */
export const SESSION_COOKIE = 'txn_session';

/** Default back-end for local development. */
export const DEFAULT_BACKEND_URL = 'http://localhost:5100/api';

/** The back-end API base URL (no trailing slash), e.g. `http://localhost:5100/api`. */
export function backendUrl(): string {
  const configured = process.env.BACKEND_URL?.trim();
  return (configured || DEFAULT_BACKEND_URL).replace(/\/+$/, '');
}
