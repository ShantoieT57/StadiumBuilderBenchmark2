/**
 * Same-origin proxy: every browser call to `/api/*` is forwarded to the
 * back-end at `${BACKEND_URL}/*` (BR8). The back-end sends no CORS headers, so
 * the browser never calls it directly.
 *
 * - The `txn_session` cookie goes through in both directions (request `Cookie`,
 *   response `Set-Cookie`).
 * - Response bodies are streamed, so long-lived responses pass through.
 * - When the back-end cannot be reached, the proxy answers 502 so the client
 *   can tell a connection problem from an HTTP refusal.
 *
 * - Only the documented back-end operations are forwarded: the method and path
 *   are validated against `BACKEND_ENDPOINTS` (ids as UUIDs); anything else gets
 *   a 404 and never reaches the back-end.
 * - Every operation except signing in / out needs the session cookie
 *   (`requireAuth`); without it the proxy answers the back-end's own 401
 *   `NotSignedIn` shape. The back-end remains the authority on the session.
 *
 * A route handler (rather than next.config rewrites) is used so BACKEND_URL is
 * read at request time and an unreachable back-end yields a clean 502.
 */
import type { NextRequest } from 'next/server';

import { requireAuth } from '@/lib/auth/requireAuth';
import { backendUrl } from '@/lib/server/backend';
import {
  BACKEND_ENDPOINTS,
  type BackendEndpoint,
} from '@/lib/server/backendEndpoints';

export const dynamic = 'force-dynamic';

/** Request headers forwarded to the back-end. Everything else stays here. */
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'cookie',
  'last-event-id',
];

/** Response headers that describe this hop, not the payload. */
const DROPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'set-cookie',
  'transfer-encoding',
]);

/** The request's path relative to `/api`, e.g. `/files/<id>`. */
function backendPath(request: NextRequest): string {
  return request.nextUrl.pathname.replace(/^\/api/, '');
}

/** The documented operation this request is for, if any. */
function endpointFor(request: NextRequest): BackendEndpoint | undefined {
  const segments = backendPath(request).replace(/^\//, '').split('/');
  return BACKEND_ENDPOINTS.find(
    (endpoint) =>
      endpoint.methods.some((method) => method === request.method) &&
      endpoint.path.safeParse(segments).success,
  );
}

function targetUrl(request: NextRequest): string {
  return `${backendUrl()}${backendPath(request)}${request.nextUrl.search}`;
}

function forwardedHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

function unreachable(): Response {
  return Response.json(
    { message: 'The app could not be reached. Please try again shortly.' },
    { status: 502 },
  );
}

function notFound(): Response {
  return Response.json({ message: 'Not found.' }, { status: 404 });
}

async function proxy(request: NextRequest): Promise<Response> {
  const endpoint = endpointFor(request);
  if (!endpoint) return notFound();
  if (!endpoint.anonymous) {
    const denied = requireAuth(request);
    if (denied) return denied;
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl(request), {
      method: request.method,
      headers: forwardedHeaders(request),
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
      signal: request.signal,
    });
  } catch {
    return unreachable();
  }

  const headers = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) {
      headers.set(name, value);
    }
  });
  for (const cookie of upstream.headers.getSetCookie()) {
    headers.append('set-cookie', cookie);
  }
  if (headers.get('content-type')?.startsWith('text/event-stream')) {
    // Live stream (`GET /events`): pass each frame through as it arrives.
    // `no-transform` keeps the server's response compression off it, and
    // `X-Accel-Buffering` stops a reverse proxy in front from buffering it.
    headers.set('cache-control', 'no-cache, no-transform');
    headers.set('x-accel-buffering', 'no');
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
