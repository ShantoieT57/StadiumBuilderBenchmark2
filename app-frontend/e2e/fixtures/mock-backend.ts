/**
 * Stateless Node-side mock back-end shared by every E2E spec.
 *
 * Why it exists: the signed-in layout calls `GET /auth/me` from the Next.js SERVER
 * (BR3 / NFR-1), and `page.route()` cannot intercept Node-side fetches. During E2E,
 * playwright.config.ts points the web server's `BACKEND_URL` at this server
 * (started and stopped by e2e/global-setup.ts). Browser-side `/api/*` calls are
 * still mocked per spec with `page.route()`. Specs never contact the live back-end.
 *
 * Session state lives entirely in the `txn_session` cookie value, so the mock is
 * parallel-safe and holds no shared state:
 *   - `mock-session-<Role>`            active session -> GET auth/me 200 `userInfoFor(role)`
 *   - `mock-session-<Role>-<Reason>`   ended session  -> 401 `unauthenticatedBody(reason)`
 *                                      (Reason: SessionExpired | SignedInElsewhere | SignedOut | NotSignedIn)
 *   - missing / anything else          -> 401 `unauthenticatedBody('NotSignedIn')`
 * POST auth/sign-out -> 204 and clears the cookie (anonymous, idempotent).
 * Every other request -> 401 `unauthenticatedBody('NotSignedIn')`.
 *
 * Bodies come from the project-wide identity source (never inlined here).
 */
import http from 'node:http';

import type {
  UnauthenticatedReason,
  UserRole,
} from '../../src/types/api-generated';
import {
  unauthenticatedBody,
  userInfoFor,
} from '../../src/mocks/data/identity';

/** Port the mock listens on (127.0.0.1). Must match playwright.config.ts. */
export const MOCK_BACKEND_PORT = Number(
  process.env.E2E_MOCK_BACKEND_PORT ?? 5199,
);

/** The back-end's session cookie name. */
export const SESSION_COOKIE = 'txn_session';

const ROLES: readonly UserRole[] = ['Importer', 'Approver'];
const REASONS: readonly UnauthenticatedReason[] = [
  'NotSignedIn',
  'SessionExpired',
  'SignedInElsewhere',
  'SignedOut',
];

/** Cookie value for an ACTIVE mock session held by `role`. */
export function mockSessionValue(role: UserRole): string {
  return `mock-session-${role}`;
}

/**
 * Cookie value for a session of `role` that the back-end has ENDED for `reason`
 * (idle timeout, signed in elsewhere, ...). The mock answers 401 with that reason.
 */
export function endedSessionValue(
  role: UserRole,
  reason: UnauthenticatedReason,
): string {
  return `mock-session-${role}-${reason}`;
}

/** Raw `txn_session` value from a `Cookie` header, or null. */
function sessionValueFromCookie(
  cookieHeader: string | null | undefined,
): string | null {
  if (!cookieHeader) return null;
  const pair = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return pair ? pair.slice(SESSION_COOKIE.length + 1) : null;
}

/** The role of an ACTIVE mock session in a `Cookie` header, or null. */
export function roleFromCookie(
  cookieHeader: string | null | undefined,
): UserRole | null {
  const value = sessionValueFromCookie(cookieHeader);
  return ROLES.find((role) => value === mockSessionValue(role)) ?? null;
}

/** The 401 reason of an ENDED mock session in a `Cookie` header, or null. */
export function endedReasonFromCookie(
  cookieHeader: string | null | undefined,
): UnauthenticatedReason | null {
  const value = sessionValueFromCookie(cookieHeader);
  for (const role of ROLES) {
    const reason = REASONS.find((r) => value === endedSessionValue(role, r));
    if (reason) return reason;
  }
  return null;
}

/** `Set-Cookie` that clears the session, as the back-end does on sign-out. */
export const CLEAR_SESSION_COOKIE = `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;

export interface MockResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function json(status: number, payload: unknown): MockResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

/**
 * The mock back-end's answer for `method path` (path relative to the `/api` base,
 * e.g. `/auth/me`) given the request's `Cookie` header. Usable from `page.route()`
 * handlers too, so browser-side and server-side mocks agree.
 */
export function respondFor(
  method: string,
  path: string,
  cookieHeader: string | null | undefined,
): MockResponse {
  if (method === 'POST' && path === '/auth/sign-out') {
    return {
      status: 204,
      headers: { 'set-cookie': CLEAR_SESSION_COOKIE },
      body: '',
    };
  }
  if (method === 'GET' && path === '/auth/me') {
    const role = roleFromCookie(cookieHeader);
    if (role) return json(200, userInfoFor(role));
    return json(
      401,
      unauthenticatedBody(endedReasonFromCookie(cookieHeader) ?? 'NotSignedIn'),
    );
  }
  return json(401, unauthenticatedBody('NotSignedIn'));
}

/** Starts the mock back-end on 127.0.0.1. Resolves with a function that stops it. */
export function startMockBackend(
  port: number = MOCK_BACKEND_PORT,
): Promise<() => Promise<void>> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const path = url.pathname.replace(/^\/api/, '');
    const { status, headers, body } = respondFor(
      req.method ?? 'GET',
      path,
      req.headers.cookie,
    );
    res.writeHead(status, headers);
    res.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve(
        () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      );
    });
  });
}
