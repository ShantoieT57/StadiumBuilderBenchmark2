// @vitest-environment node
/**
 * Same-origin `/api` proxy (Story 1, BR8): only documented back-end operations
 * are forwarded, and signed-in operations need the session cookie.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, PATCH, POST } from '@/app/api/[...path]/route';
import { sessionEndedFrame, unauthenticatedBody } from '@/mocks/data/identity';

const FILE_ID = '3f2b8c1e-4d5a-4b6c-8e7f-1a2b3c4d5e6f';
const SESSION = 'txn_session=abc123';

const backend = vi.fn<typeof fetch>();

beforeEach(() => {
  backend.mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', backend);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function request(method: string, path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api${path}`, {
    method,
    headers: cookie ? { cookie } : {},
  });
}

describe('API proxy', () => {
  it('forwards a documented operation for a signed-in person', async () => {
    const response = await GET(
      request('GET', `/files/${FILE_ID}/content`, SESSION),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(String(backend.mock.calls[0][0])).toMatch(
      new RegExp(`/files/${FILE_ID}/content$`),
    );
  });

  it('lets signing in through without a session', async () => {
    const response = await POST(request('POST', '/auth/sign-in'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('refuses a signed-in operation without a session, without calling the back-end', async () => {
    const response = await GET(request('GET', '/transactions'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      message: 'You are not signed in.',
      reason: 'NotSignedIn',
    });
    expect(backend).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/swagger/index.html'],
    ['GET', '/files/not-an-id'],
    ['PATCH', `/files/${FILE_ID}`],
    ['GET', '/transactions/export/extra'],
  ])(
    'answers 404 for undocumented %s %s, without calling the back-end',
    async (method, path) => {
      const handler = method === 'PATCH' ? PATCH : GET;
      const response = await handler(request(method, path, SESSION));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ message: 'Not found.' });
      expect(backend).not.toHaveBeenCalled();
    },
  );

  describe('live stream (GET /events) refused', () => {
    it('tells the stream the session ended when the back-end answers 401', async () => {
      backend.mockResolvedValueOnce(
        new Response(JSON.stringify(unauthenticatedBody('SessionExpired')), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const response = await GET(request('GET', '/events', SESSION));

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(
        /^text\/event-stream/,
      );
      expect(await response.text()).toBe(sessionEndedFrame('SessionExpired'));
    });

    it('tells the stream the person is not signed in when there is no session', async () => {
      const response = await GET(request('GET', '/events'));

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(
        /^text\/event-stream/,
      );
      expect(await response.text()).toBe(sessionEndedFrame('NotSignedIn'));
      expect(backend).not.toHaveBeenCalled();
    });

    it('passes any other refusal of the stream through unchanged', async () => {
      backend.mockResolvedValueOnce(
        new Response('Service starting', {
          status: 401,
          headers: { 'content-type': 'text/plain' },
        }),
      );

      const response = await GET(request('GET', '/events', SESSION));

      expect(response.status).toBe(401);
      expect(await response.text()).toBe('Service starting');
    });

    it('still answers 401 to other signed-in operations', async () => {
      backend.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ message: 'Signed out.', reason: 'SignedOut' }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
      );

      const response = await GET(request('GET', '/transactions', SESSION));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        message: 'Signed out.',
        reason: 'SignedOut',
      });
    });
  });
});
