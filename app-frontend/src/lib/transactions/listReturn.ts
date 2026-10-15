/**
 * Remembers the transactions list's last view (its URL search string) for the
 * tab, so the details screen's "Back to transactions" link returns to the same
 * filters, sort, page and page size (BR2). Row links stay plain
 * `/transactions/<id>`; browser Back restores the list from the URL itself.
 */
import { parseListState, toListSearch } from '@/lib/transactions/listQuery';

const STORAGE_KEY = 'transactions:listSearch';
const LIST_PATH = '/transactions';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Records the list's current search string (no leading `?`). */
export function rememberListSearch(search: string): void {
  try {
    storage()?.setItem(STORAGE_KEY, search);
  } catch {
    // Storage full or blocked: the back link falls back to the default list.
  }
}

/** The last remembered list search, normalised through the list state ('' when none). */
export function rememberedListSearch(): string {
  let saved: string | null = null;
  try {
    saved = storage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    saved = null;
  }
  if (!saved) return '';
  return toListSearch(parseListState(new URLSearchParams(saved)));
}

/** The list URL for a search string. */
export function transactionsListHref(search: string): string {
  return search ? `${LIST_PATH}?${search}` : LIST_PATH;
}
