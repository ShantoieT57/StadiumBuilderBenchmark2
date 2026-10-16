/**
 * The transactions list's view state, carried in the URL search params (BR2).
 *
 * Param names and values are the API's own (`sortBy=Amount&sortDirection=Desc`),
 * so a list URL maps one-to-one onto `GET /transactions`. Defaults
 * (TransactionDate newest first, page 1, 20 per page) are left out of the URL;
 * any other sort writes both `sortBy` and `sortDirection`.
 */
import type {
  ExportTransactionsQuery,
  ListTransactionsQuery,
  SortDirection,
  TransactionSortColumn,
  TransactionStatus,
} from '@/types/api-generated';

export const TRANSACTION_PAGE_SIZES = [5, 10, 20, 50] as const;
export type TransactionPageSize = (typeof TRANSACTION_PAGE_SIZES)[number];

export const DEFAULT_SORT_COLUMN: TransactionSortColumn = 'TransactionDate';
export const DEFAULT_PAGE_SIZE: TransactionPageSize = 20;

const SORT_COLUMNS: readonly TransactionSortColumn[] = [
  'TransactionDate',
  'Reference',
  'AccountNumber',
  'Description',
  'Amount',
  'Currency',
  'TransactionType',
  'Status',
  'FileName',
];

export const TRANSACTION_STATUSES: readonly TransactionStatus[] = [
  'Imported',
  'Approved',
  'Rejected',
];

/** The filters a list URL can carry (set by the filter form, or by links into the list). */
export interface TransactionListFilters {
  status?: TransactionStatus;
  fileId?: string;
  dateFrom?: string;
  dateTo?: string;
  minAmount?: number;
  maxAmount?: number;
  search?: string;
}

export interface TransactionListState {
  sortBy: TransactionSortColumn;
  sortDirection: SortDirection;
  page: number;
  pageSize: TransactionPageSize;
  filters: TransactionListFilters;
}

/** Newest first for the date; A-Z / smallest first for every other column. */
export function defaultDirectionFor(
  column: TransactionSortColumn,
): SortDirection {
  return column === DEFAULT_SORT_COLUMN ? 'Desc' : 'Asc';
}

/** Read-only view of URL search params (`URLSearchParams` or Next's `ReadonlyURLSearchParams`). */
export interface SearchParamsReader {
  get(name: string): string | null;
}

function text(params: SearchParamsReader, name: string): string | undefined {
  const value = params.get(name)?.trim();
  return value ? value : undefined;
}

function amount(params: SearchParamsReader, name: string): number | undefined {
  const value = text(params, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  // The API takes non-negative amounts only; a hand-edited URL must not 400 the list.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function date(params: SearchParamsReader, name: string): string | undefined {
  const value = text(params, name);
  return value !== undefined && DATE_PATTERN.test(value) ? value : undefined;
}

/**
 * A range from the URL: a reversed one (start after end) is dropped whole, as
 * the API answers it with 400. yyyy-MM-dd dates compare correctly as strings.
 */
function ordered<T extends string | number>(
  from: T | undefined,
  to: T | undefined,
): [T | undefined, T | undefined] {
  if (from !== undefined && to !== undefined && from > to) {
    return [undefined, undefined];
  }
  return [from, to];
}

function pick<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return allowed.find((option) => option === value);
}

/** Parses the list state from the URL; unknown or invalid values fall back to the defaults. */
export function parseListState(
  params: SearchParamsReader,
): TransactionListState {
  const sortBy =
    pick(text(params, 'sortBy'), SORT_COLUMNS) ?? DEFAULT_SORT_COLUMN;
  const sortDirection =
    pick<SortDirection>(text(params, 'sortDirection'), ['Asc', 'Desc']) ??
    defaultDirectionFor(sortBy);
  const pageNumber = Number(text(params, 'page') ?? 1);
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 ? pageNumber : 1;
  const pageSize =
    TRANSACTION_PAGE_SIZES.find(
      (size) => size === Number(text(params, 'pageSize')),
    ) ?? DEFAULT_PAGE_SIZE;

  const [dateFrom, dateTo] = ordered(
    date(params, 'dateFrom'),
    date(params, 'dateTo'),
  );
  const [minAmount, maxAmount] = ordered(
    amount(params, 'minAmount'),
    amount(params, 'maxAmount'),
  );
  const filters: TransactionListFilters = {
    status: pick(text(params, 'status'), TRANSACTION_STATUSES),
    fileId: text(params, 'fileId'),
    dateFrom,
    dateTo,
    minAmount,
    maxAmount,
    search: text(params, 'search'),
  };

  return { sortBy, sortDirection, page, pageSize, filters };
}

/** The `GET /transactions` query for a list state (every value explicit). */
export function toTransactionsQuery(
  state: TransactionListState,
): ListTransactionsQuery {
  return withFilterParams(
    {
      sortBy: state.sortBy,
      sortDirection: state.sortDirection,
      page: state.page,
      pageSize: state.pageSize,
    },
    state.filters,
  );
}

/**
 * The `GET /transactions/export` query for a list state: the list's filters and
 * sort, without `page` / `pageSize` (the export spans every page).
 */
export function toExportQuery(
  state: TransactionListState,
): ExportTransactionsQuery {
  return withFilterParams(
    { sortBy: state.sortBy, sortDirection: state.sortDirection },
    state.filters,
  );
}

/** `query` with every filter that is set added to it. */
function withFilterParams<Q extends ExportTransactionsQuery>(
  query: Q,
  filters: TransactionListFilters,
): Q {
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') {
      Object.assign(query, { [key]: value });
    }
  }
  return query;
}

/** The URL search string (no leading `?`) for a list state, with defaults omitted. */
export function toListSearch(state: TransactionListState): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state.filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  // Only the true default (TransactionDate, newest first) stays out of the URL;
  // any other sort carries both params so a shared link is unambiguous.
  if (
    state.sortBy !== DEFAULT_SORT_COLUMN ||
    state.sortDirection !== defaultDirectionFor(DEFAULT_SORT_COLUMN)
  ) {
    params.set('sortBy', state.sortBy);
    params.set('sortDirection', state.sortDirection);
  }
  if (state.page !== 1) params.set('page', String(state.page));
  if (state.pageSize !== DEFAULT_PAGE_SIZE) {
    params.set('pageSize', String(state.pageSize));
  }
  return params.toString();
}

/** Sorting by `column`: toggles the current column, else that column's default direction. Keeps page and filters. */
export function withSort(
  state: TransactionListState,
  column: TransactionSortColumn,
): TransactionListState {
  const sortDirection: SortDirection =
    state.sortBy === column
      ? state.sortDirection === 'Asc'
        ? 'Desc'
        : 'Asc'
      : defaultDirectionFor(column);
  return { ...state, sortBy: column, sortDirection };
}

export function withPage(
  state: TransactionListState,
  page: number,
): TransactionListState {
  return { ...state, page: Math.max(1, page) };
}

/** A new page size always returns to page 1 (BR3). */
export function withPageSize(
  state: TransactionListState,
  pageSize: TransactionPageSize,
): TransactionListState {
  return { ...state, pageSize, page: 1 };
}

/** New filters always return to page 1 and keep the sort (BR3). */
export function withFilters(
  state: TransactionListState,
  filters: TransactionListFilters,
): TransactionListState {
  return { ...state, filters, page: 1 };
}
