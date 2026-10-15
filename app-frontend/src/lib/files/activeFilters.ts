/**
 * The active filters of a Dashboard file list view, in display order, with the
 * words a person sees (status in words, the visibility as a sentence) (R5, R6).
 */
import type { FileListFilters } from '@/lib/files/listQuery';
import { formatFileStatus } from '@/lib/format/file';

export type FileFilterKey = keyof FileListFilters;

export const FILE_FILTER_LABELS: Record<FileFilterKey, string> = {
  status: 'Status',
  fileName: 'File name',
  processedFrom: 'Processed from',
  processedTo: 'Processed to',
  visibility: 'Show',
};

const FILTER_ORDER: readonly FileFilterKey[] = [
  'status',
  'fileName',
  'processedFrom',
  'processedTo',
  'visibility',
];

export const SHOWING_CANCELLED = 'Showing cancelled';
export const SHOWING_ACTIVE_AND_CANCELLED = 'Showing active and cancelled';

export interface ActiveFileFilter {
  key: FileFilterKey;
  label: string;
  value: string;
  /** The words shown on its own, e.g. "Status: Failed" or "Showing cancelled". */
  text: string;
}

/** One entry per filter that is set. */
export function activeFileFilters(
  filters: FileListFilters,
): ActiveFileFilter[] {
  const entries: ActiveFileFilter[] = [];
  for (const key of FILTER_ORDER) {
    const raw = filters[key];
    if (raw === undefined || raw === '') continue;
    const label = FILE_FILTER_LABELS[key];
    if (key === 'visibility') {
      const value =
        filters.visibility === 'Both'
          ? SHOWING_ACTIVE_AND_CANCELLED
          : SHOWING_CANCELLED;
      entries.push({ key, label, value, text: value });
      continue;
    }
    const value =
      key === 'status' && filters.status
        ? formatFileStatus(filters.status)
        : String(raw);
    entries.push({ key, label, value, text: `${label}: ${value}` });
  }
  return entries;
}

/** The filters without `key`. */
export function withoutFileFilter(
  filters: FileListFilters,
  key: FileFilterKey,
): FileListFilters {
  return { ...filters, [key]: undefined };
}
