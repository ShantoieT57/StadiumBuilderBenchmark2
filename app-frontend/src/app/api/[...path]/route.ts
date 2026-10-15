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
 * - The live stream (`GET /events`) never answers the browser with a 401: an
 *   `EventSource` cannot read an error response and would just reconnect
 *   forever. A refused stream (no cookie here, or the back-end's 401
 *   `{ message, reason }`) is answered 200 `text/event-stream` with a single
 *   `session-ended` event carrying that reason, then the stream ends, so the
 *   tab's live connection leaves for sign-in like any other ended session.
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
import { toUnauthenticatedReason } from '@/lib/auth/signIn';
import { backendUrl } from '@/lib/server/backend';
import {
  BACKEND_ENDPOINTS,
  type BackendEndpoint,
} from '@/lib/server/backendEndpoints';
import type {
  SessionEndedEvent,
  UnauthenticatedResponse,
} from '@/types/api-generated';

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

/** True for the live stream, `GET /events`. */
function isEventStream(request: NextRequest): boolean {
  return request.method === 'GET' && backendPath(request) === '/events';
}

/** Reads a 401 `{ message, reason }` body; undefined when it is not one. */
async function unauthenticatedBody(
  response: Response,
): Promise<UnauthenticatedResponse | undefined> {
  if (!response.headers.get('content-type')?.includes('json')) return undefined;
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return undefined;
    const { message, reason } = body as Record<string, unknown>;
    if (typeof message !== 'string' || typeof reason !== 'string') {
      return undefined;
    }
    return { message, reason: toUnauthenticatedReason(reason) };
  } catch {
    return undefined;
  }
}

/**
 * A complete event stream holding only a `session-ended` event: how a refused
 * `GET /events` is told to the browser's `EventSource`.
 */
function sessionEndedStream(ended: UnauthenticatedResponse): Response {
  const data: SessionEndedEvent = {
    message: ended.message,
    reason: ended.reason,
  };
  return new Response(
    `event: session-ended\ndata: ${JSON.stringify(data)}\n\n`,
    {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      },
    },
  );
}

async function proxy(request: NextRequest): Promise<Response> {
  const endpoint = endpointFor(request);
  if (!endpoint) return notFound();
  if (!endpoint.anonymous) {
    const denied = requireAuth(request);
    if (denied) {
      if (isEventStream(request)) {
        const ended = await unauthenticatedBody(denied);
        if (ended) return sessionEndedStream(ended);
      }
      return denied;
    }
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  // The request body is streamed through too (e.g. a file upload is never
  // held whole in memory); a streamed body needs `duplex: 'half'`.
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers: forwardedHeaders(request),
    redirect: 'manual',
    cache: 'no-store',
    signal: request.signal,
  };
  if (hasBody && request.body) {
    init.body = request.body;
    init.duplex = 'half';
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl(request), init);
  } catch {
    return unreachable();
  }

  if (upstream.status === 401 && isEventStream(request)) {
    const ended = await unauthenticatedBody(upstream.clone());
    if (ended) {
      await upstream.body?.cancel();
      return sessionEndedStream(ended);
    }
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
