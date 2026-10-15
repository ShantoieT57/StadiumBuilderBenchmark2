'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import {
  parseFileListState,
  toFileListSearch,
  type FileListState,
} from '@/lib/files/listQuery';

export interface FileListQuery {
  /** The file list view read from the URL search params. */
  view: FileListState;
  /** Pushes the URL for a new view (no scroll jump), so Back restores the old one. */
  navigate: (next: FileListState) => void;
}

/** The Dashboard file list view held in the URL, and the way to change it. */
export function useFileListQuery(): FileListQuery {
  const router = useRouter();
  const pathname = usePathname() ?? '/dashboard';
  const searchParams = useSearchParams();
  const urlSearch = searchParams?.toString() ?? '';

  const view = useMemo(
    () => parseFileListState(new URLSearchParams(urlSearch)),
    [urlSearch],
  );

  const navigate = useCallback(
    (next: FileListState) => {
      const search = toFileListSearch(next);
      router.push(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname],
  );

  return { view, navigate };
}
