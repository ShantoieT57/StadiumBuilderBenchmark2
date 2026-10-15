'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import {
  parseListState,
  toListSearch,
  type TransactionListState,
} from '@/lib/transactions/listQuery';

export interface ListQuery {
  /** The list view read from the URL search params. */
  view: TransactionListState;
  /** Pushes the URL for a new view (no scroll jump), so Back restores the old one. */
  navigate: (next: TransactionListState) => void;
}

/** The transactions list view held in the URL, and the way to change it. */
export function useListQuery(): ListQuery {
  const router = useRouter();
  const pathname = usePathname() ?? '/transactions';
  const searchParams = useSearchParams();
  const urlSearch = searchParams?.toString() ?? '';

  const view = useMemo(
    () => parseListState(new URLSearchParams(urlSearch)),
    [urlSearch],
  );

  const navigate = useCallback(
    (next: TransactionListState) => {
      const search = toListSearch(next);
      router.push(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname],
  );

  return { view, navigate };
}
