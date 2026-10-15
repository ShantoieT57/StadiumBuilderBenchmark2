/**
 * Remembers the Dashboard file list's last view (its URL search string) for the
 * tab, so the file details screen's "Back to dashboard" link returns to the same
 * filters, sort, page and page size (BR2). File-name links stay plain
 * `/dashboard/files/<id>`; browser Back restores the list from the URL itself.
 */
import { parseFileListState, toFileListSearch } from '@/lib/files/listQuery';

const STORAGE_KEY = 'files:listSearch';
const LIST_PATH = '/dashboard';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Records the file list's current search string (no leading `?`). */
export function rememberFileListSearch(search: string): void {
  try {
    storage()?.setItem(STORAGE_KEY, search);
  } catch {
    // Storage full or blocked: the back link falls back to the default list.
  }
}

/** The last remembered file list search, normalised through the list state ('' when none). */
export function rememberedFileListSearch(): string {
  let saved: string | null = null;
  try {
    saved = storage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    saved = null;
  }
  if (!saved) return '';
  return toFileListSearch(parseFileListState(new URLSearchParams(saved)));
}

/** The Dashboard URL for a file list search string. */
export function dashboardListHref(search: string): string {
  return search ? `${LIST_PATH}?${search}` : LIST_PATH;
}
