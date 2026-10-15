'use client';

import { useEffect, useState } from 'react';

import { getFiles } from '@/lib/api/endpoints';
import { isRedirectingToSignIn } from '@/lib/api/errors';
import type { FileListItem } from '@/types/api-generated';

/** The most files the back-end returns in one page; the file filter offers these. */
export const FILE_OPTIONS_LIMIT = 50;

export const LOADING_FILE_NAME = 'Loading file name…';
/** Shown for a file id that is not among the most recent files loaded. */
export const UNLISTED_FILE_NAME = 'Selected file';

export interface FileOptions {
  /** Null until loaded (or when not enabled). */
  files: FileListItem[] | null;
  failed: boolean;
}

/**
 * The most recently processed files (one page of 50), for the file filter and
 * for showing a filtered file by its name. Older files are not offered.
 */
export function useFileOptions(enabled = true): FileOptions {
  const [state, setState] = useState<FileOptions>({
    files: null,
    failed: false,
  });

  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    getFiles({
      pageSize: FILE_OPTIONS_LIMIT,
      sortBy: 'LastProcessedAt',
      sortDirection: 'Desc',
    }).then(
      (page) => {
        if (current) setState({ files: page.items, failed: false });
      },
      (error: unknown) => {
        if (!current || isRedirectingToSignIn(error)) return;
        setState({ files: [], failed: true });
      },
    );
    return () => {
      current = false;
    };
  }, [enabled]);

  return state;
}

/** A file's name from the loaded options. */
export function fileNameFor(
  files: FileListItem[] | null,
  fileId: string,
): string {
  if (files === null) return LOADING_FILE_NAME;
  return (
    files.find((file) => file.id === fileId)?.fileName ?? UNLISTED_FILE_NAME
  );
}
