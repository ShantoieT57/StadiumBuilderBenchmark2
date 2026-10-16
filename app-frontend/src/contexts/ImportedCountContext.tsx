'use client';

/**
 * The Approver's "waiting for review" count on the Transactions menu item.
 *
 * `ImportedCountProvider` (mounted inside `EventsProvider` in the signed-in
 * layout, for Approvers only) loads `GET /transactions/imported-count` on mount
 * and again on `transactions-changed` / `resync`. There is no timer polling.
 *
 * `useImportedCount().refreshImportedCount()` asks the count to refetch after this
 * person's own approve / reject (including a "someone got there first" answer).
 * Outside a provider (Importer screens, tests without the shell) it is a no-op,
 * so callers never need to check.
 *
 * A failed load is silent: the last known count stays (or no badge before the
 * first success) and the next event or own action tries again. The list itself
 * reports load problems.
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

import { useEvents } from '@/contexts/EventsContext';
import { getImportedTransactionCount } from '@/lib/api/endpoints';

export interface ImportedCountContextValue {
  /** The last known count, or null before the first successful load. */
  count: number | null;
  /** Refetches the count; never throws. */
  refreshImportedCount: () => void;
}

const NO_COUNT: ImportedCountContextValue = {
  count: null,
  refreshImportedCount: () => undefined,
};

export const ImportedCountContext =
  createContext<ImportedCountContextValue>(NO_COUNT);

export function ImportedCountProvider({ children }: { children: ReactNode }) {
  const { subscribe } = useEvents();
  const [count, setCount] = useState<number | null>(null);
  // Only the newest request may set the count, so a slow older answer cannot
  // overwrite a fresher one.
  const latestRequestRef = useRef(0);
  const mountedRef = useRef(true);

  const refreshImportedCount = useCallback(() => {
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    getImportedTransactionCount().then(
      (body) => {
        if (!mountedRef.current || requestId !== latestRequestRef.current) {
          return;
        }
        setCount(body.count);
      },
      () => {
        // Silent by design (including a sign-in redirect already under way):
        // keep the last known count; the next update retries.
      },
    );
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refreshImportedCount();
    const unsubscribeChanged = subscribe(
      'transactions-changed',
      refreshImportedCount,
    );
    const unsubscribeResync = subscribe('resync', refreshImportedCount);
    return () => {
      mountedRef.current = false;
      unsubscribeChanged();
      unsubscribeResync();
    };
  }, [subscribe, refreshImportedCount]);

  const value = useMemo(
    () => ({ count, refreshImportedCount }),
    [count, refreshImportedCount],
  );

  return (
    <ImportedCountContext.Provider value={value}>
      {children}
    </ImportedCountContext.Provider>
  );
}

export function useImportedCount(): ImportedCountContextValue {
  return useContext(ImportedCountContext);
}
