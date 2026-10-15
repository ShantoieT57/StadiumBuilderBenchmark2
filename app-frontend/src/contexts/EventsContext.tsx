'use client';

/**
 * EventsContext - the tab's single live connection to the back-end (NFR-2).
 *
 * Opens one browser `EventSource` to the same-origin `/api/events` stream and
 * fans its named events out to subscribers (`useEvents().subscribe`).
 *
 * - The browser reconnects by itself while the stream is CONNECTING, using the
 *   server's `retry: 5000`. When it gives up (CLOSED, e.g. the proxy answered
 *   502 while the back-end restarts) a new connection is opened after the same
 *   5 seconds.
 * - `session-ended` closes the connection for good and returns the person to
 *   sign-in with the matching reason (BR4 / BR7). A reconnect after the
 *   session ended also gets it: the `/api` proxy answers a refused stream with
 *   a `session-ended` event rather than a 401 the browser cannot read.
 * - `close()` (sign-out) closes it for good; `reopen()` undoes that if the
 *   sign-out could not be completed.
 * - Holding the stream is not session activity, and nothing here polls
 *   `/auth/me`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { API_BASE_URL } from '@/lib/utils/constants';
import { redirectToSignIn } from '@/lib/auth/signIn';
import type { SseEventData } from '@/types/api-generated';

export type LiveEventName = keyof SseEventData;
export type LiveEventHandler<K extends LiveEventName> = (
  data: SseEventData[K],
) => void;

export interface EventsContextValue {
  /** Calls `handler` with each `eventName` payload; returns the unsubscribe function. */
  subscribe: <K extends LiveEventName>(
    eventName: K,
    handler: LiveEventHandler<K>,
  ) => () => void;
  /** Closes the live connection and stops reconnecting (sign-out). */
  close: () => void;
  /** Re-opens a connection closed by `close()`. */
  reopen: () => void;
}

/** Same-origin stream route (proxied to the back-end's `GET /events`). */
export const EVENTS_URL = `${API_BASE_URL}/events`;

/** Matches the server's `retry: 5000`. */
export const RECONNECT_DELAY_MS = 5000;

const EVENT_NAMES: readonly LiveEventName[] = [
  'file-changed',
  'transactions-changed',
  'resync',
  'session-ended',
];

type AnyHandler = (data: unknown) => void;

const EventsContext = createContext<EventsContextValue | undefined>(undefined);

function parseData(event: Event): unknown {
  const raw = (event as MessageEvent).data;
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function EventsProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef(new Map<LiveEventName, Set<AnyHandler>>());
  const sourceRef = useRef<EventSource | null>(null);
  const stoppedRef = useRef(false);
  // Bumped to open a fresh connection (after a drop, or on reopen()).
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (stoppedRef.current || typeof EventSource === 'undefined') return;

    const source = new EventSource(EVENTS_URL);
    sourceRef.current = source;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const stop = () => {
      clearTimeout(retryTimer);
      source.close();
      if (sourceRef.current === source) sourceRef.current = null;
    };

    for (const name of EVENT_NAMES) {
      source.addEventListener(name, (event) => {
        const data = parseData(event);
        if (name === 'session-ended') {
          stoppedRef.current = true;
          stop();
          redirectToSignIn((data as { reason?: unknown } | undefined)?.reason);
        }
        handlersRef.current.get(name)?.forEach((handler) => handler(data));
      });
    }

    source.onerror = () => {
      // CONNECTING: the browser is already retrying with the server's delay.
      if (source.readyState !== source.CLOSED || stoppedRef.current) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(
        () => setGeneration((current) => current + 1),
        RECONNECT_DELAY_MS,
      );
    };

    return stop;
  }, [generation]);

  const subscribe = useCallback(
    <K extends LiveEventName>(
      eventName: K,
      handler: LiveEventHandler<K>,
    ): (() => void) => {
      const anyHandler = handler as AnyHandler;
      const handlers = handlersRef.current;
      const set = handlers.get(eventName) ?? new Set<AnyHandler>();
      set.add(anyHandler);
      handlers.set(eventName, set);
      return () => {
        set.delete(anyHandler);
      };
    },
    [],
  );

  const close = useCallback(() => {
    stoppedRef.current = true;
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const reopen = useCallback(() => {
    if (!stoppedRef.current) return;
    stoppedRef.current = false;
    setGeneration((current) => current + 1);
  }, []);

  const value = useMemo(
    () => ({ subscribe, close, reopen }),
    [subscribe, close, reopen],
  );

  return (
    <EventsContext.Provider value={value}>{children}</EventsContext.Provider>
  );
}

/**
 * useEvents - the tab's live connection.
 * @throws Error if used outside of EventsProvider
 */
export function useEvents(): EventsContextValue {
  const context = useContext(EventsContext);
  if (context === undefined) {
    throw new Error('useEvents must be used within an EventsProvider');
  }
  return context;
}
