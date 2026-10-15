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
 * A route handler (rather than next.config rewrites) is used so BACKEND_URL is
 * read at request time and an unreachable back-end yields a clean 502.
 */
import type { NextRequest } from 'next/server';

import { backendUrl } from '@/lib/server/backend';

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

function targetUrl(request: NextRequest): string {
  const path = request.nextUrl.pathname.replace(/^\/api/, '');
  return `${backendUrl()}${path}${request.nextUrl.search}`;
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

async function proxy(request: NextRequest): Promise<Response> {
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
