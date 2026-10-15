/**
 * The active filters of a transactions list view, in display order, with the
 * words a person sees (status in words, the file by its name) (R6, BR2).
 */
import { formatTransactionStatus } from '@/lib/format/transaction';
import type { TransactionListFilters } from '@/lib/transactions/listQuery';

export type TransactionFilterKey = keyof TransactionListFilters;

export const FILTER_LABELS: Record<TransactionFilterKey, string> = {
  status: 'Status',
  fileId: 'File',
  dateFrom: 'From date',
  dateTo: 'To date',
  minAmount: 'Minimum amount',
  maxAmount: 'Maximum amount',
  search: 'Search',
};

const FILTER_ORDER: readonly TransactionFilterKey[] = [
  'status',
  'fileId',
  'dateFrom',
  'dateTo',
  'minAmount',
  'maxAmount',
  'search',
];

export interface ActiveFilter {
  key: TransactionFilterKey;
  label: string;
  value: string;
}

function formatFilterAmount(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** One entry per filter that is set; `fileName` resolves a file id to its name. */
export function activeFilters(
  filters: TransactionListFilters,
  fileName: (fileId: string) => string,
): ActiveFilter[] {
  const entries: ActiveFilter[] = [];
  for (const key of FILTER_ORDER) {
    const raw = filters[key];
    if (raw === undefined || raw === '') continue;
    let value: string;
    if (key === 'status' && filters.status) {
      value = formatTransactionStatus(filters.status);
    } else if (key === 'fileId' && filters.fileId) {
      value = fileName(filters.fileId);
    } else if (typeof raw === 'number') {
      value = formatFilterAmount(raw);
    } else {
      value = String(raw);
    }
    entries.push({ key, label: FILTER_LABELS[key], value });
  }
  return entries;
}

export function hasActiveFilters(filters: TransactionListFilters): boolean {
  return FILTER_ORDER.some(
    (key) => filters[key] !== undefined && filters[key] !== '',
  );
}

/** The filters without `key`. */
export function withoutFilter(
  filters: TransactionListFilters,
  key: TransactionFilterKey,
): TransactionListFilters {
  return { ...filters, [key]: undefined };
}
