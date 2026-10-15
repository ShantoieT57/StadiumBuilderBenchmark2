/**
 * The Dashboard file list's view state, carried in the URL search params.
 *
 * Param names and values are the API's own (`sortBy=FileName&sortDirection=Asc`),
 * so a list URL maps onto `GET /files`. Defaults (LastProcessedAt newest first,
 * page 1, 20 per page, Active files) are left out of the URL; any other sort
 * writes both `sortBy` and `sortDirection`.
 *
 * The processed-date filters are plain `yyyy-MM-dd` in the URL and are sent to
 * the API as the start / end of that day in the browser's time zone, with the
 * local offset (never `Z`).
 */
import type {
  FileSortColumn,
  FileStatus,
  FileVisibility,
  ListFilesQuery,
  SortDirection,
} from '@/types/api-generated';

export const FILE_PAGE_SIZES = [5, 10, 20, 50] as const;
export type FilePageSize = (typeof FILE_PAGE_SIZES)[number];

export const DEFAULT_FILE_SORT_COLUMN: FileSortColumn = 'LastProcessedAt';
export const DEFAULT_FILE_PAGE_SIZE: FilePageSize = 20;
export const DEFAULT_FILE_VISIBILITY: FileVisibility = 'Active';

export const FILE_SORT_COLUMNS: readonly FileSortColumn[] = [
  'FileName',
  'LastProcessedAt',
  'RowCount',
  'Status',
  'ImportedCount',
];

export const FILE_STATUSES: readonly FileStatus[] = [
  'Uploaded',
  'Processing',
  'Completed',
  'Failed',
];

export const FILE_VISIBILITIES: readonly FileVisibility[] = [
  'Active',
  'Cancelled',
  'Both',
];

/**
 * The filters a file list URL can carry. `visibility` is only set when it is
 * not the default (Active), so an empty object means "no filters".
 */
export interface FileListFilters {
  status?: FileStatus;
  fileName?: string;
  /** `yyyy-MM-dd` (local day). */
  processedFrom?: string;
  /** `yyyy-MM-dd` (local day). */
  processedTo?: string;
  visibility?: Exclude<FileVisibility, 'Active'>;
}

export interface FileListState {
  sortBy: FileSortColumn;
  sortDirection: SortDirection;
  page: number;
  pageSize: FilePageSize;
  filters: FileListFilters;
}

/** Newest first for last processed; A-Z / smallest first for every other column. */
export function defaultFileDirectionFor(column: FileSortColumn): SortDirection {
  return column === DEFAULT_FILE_SORT_COLUMN ? 'Desc' : 'Asc';
}

/** Read-only view of URL search params (`URLSearchParams` or Next's `ReadonlyURLSearchParams`). */
export interface SearchParamsReader {
  get(name: string): string | null;
}

function text(params: SearchParamsReader, name: string): string | undefined {
  const value = params.get(name)?.trim();
  return value ? value : undefined;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day in `yyyy-MM-dd`, else undefined. */
function date(params: SearchParamsReader, name: string): string | undefined {
  const value = text(params, name);
  if (value === undefined) return undefined;
  const match = DATE_PATTERN.exec(value);
  if (!match) return undefined;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const check = new Date(year, month - 1, day);
  return check.getFullYear() === year &&
    check.getMonth() === month - 1 &&
    check.getDate() === day
    ? value
    : undefined;
}

function pick<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return allowed.find((option) => option === value);
}

/** Parses the list state from the URL; unknown, invalid or reversed values fall back to the defaults. */
export function parseFileListState(params: SearchParamsReader): FileListState {
  const sortBy =
    pick(text(params, 'sortBy'), FILE_SORT_COLUMNS) ?? DEFAULT_FILE_SORT_COLUMN;
  const sortDirection =
    pick<SortDirection>(text(params, 'sortDirection'), ['Asc', 'Desc']) ??
    defaultFileDirectionFor(sortBy);
  const pageNumber = Number(text(params, 'page') ?? 1);
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 ? pageNumber : 1;
  const pageSize =
    FILE_PAGE_SIZES.find((size) => size === Number(text(params, 'pageSize'))) ??
    DEFAULT_FILE_PAGE_SIZE;

  let processedFrom = date(params, 'processedFrom');
  let processedTo = date(params, 'processedTo');
  // A reversed range is dropped whole (the API answers it with 400);
  // yyyy-MM-dd dates compare correctly as strings.
  if (processedFrom && processedTo && processedFrom > processedTo) {
    processedFrom = undefined;
    processedTo = undefined;
  }
  // Active is the default, so only the other two are kept as a filter.
  const visibility = pick<Exclude<FileVisibility, 'Active'>>(
    text(params, 'visibility'),
    ['Cancelled', 'Both'],
  );

  const filters: FileListFilters = {
    status: pick(text(params, 'status'), FILE_STATUSES),
    fileName: text(params, 'fileName'),
    processedFrom,
    processedTo,
    visibility,
  };

  return { sortBy, sortDirection, page, pageSize, filters };
}

/** Whether any filter (including a non-default visibility) is in use. */
export function hasFileFilters(filters: FileListFilters): boolean {
  return Object.values(filters).some(
    (value) => value !== undefined && value !== '',
  );
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const pad3 = (n: number): string => String(n).padStart(3, '0');

/** The local UTC offset of an instant as `±HH:MM` (never `Z`). */
function localOffset(instant: Date): string {
  const minutes = -instant.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** A local wall-clock time on a `yyyy-MM-dd` day, as ISO with the local offset. */
function localDayTime(
  day: string,
  hours: number,
  minutes: number,
  seconds: number,
  ms: number,
): string {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  const instant = new Date(
    year,
    month - 1,
    dayOfMonth,
    hours,
    minutes,
    seconds,
    ms,
  );
  return `${day}T${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${pad3(ms)}${localOffset(instant)}`;
}

/** `2026-04-30` -> `2026-04-30T00:00:00.000+02:00` (start of the local day). */
export function startOfLocalDay(day: string): string {
  return localDayTime(day, 0, 0, 0, 0);
}

/** `2026-04-30` -> `2026-04-30T23:59:59.999+02:00` (end of the local day). */
export function endOfLocalDay(day: string): string {
  return localDayTime(day, 23, 59, 59, 999);
}

/**
 * The `GET /files` query for a list state. The API client URL-encodes values,
 * so the offset's `+` is sent as `%2B`.
 */
export function toFilesQuery(state: FileListState): ListFilesQuery {
  const { filters } = state;
  const query: ListFilesQuery = {
    sortBy: state.sortBy,
    sortDirection: state.sortDirection,
    page: state.page,
    pageSize: state.pageSize,
  };
  if (filters.status) query.status = filters.status;
  if (filters.fileName) query.fileName = filters.fileName;
  if (filters.processedFrom) {
    query.processedFrom = startOfLocalDay(filters.processedFrom);
  }
  if (filters.processedTo)
    query.processedTo = endOfLocalDay(filters.processedTo);
  if (filters.visibility) query.visibility = filters.visibility;
  return query;
}

/** The URL search string (no leading `?`) for a list state, with defaults omitted. */
export function toFileListSearch(state: FileListState): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state.filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  // Only the true default (LastProcessedAt, newest first) stays out of the URL;
  // any other sort carries both params so a shared link is unambiguous.
  if (
    state.sortBy !== DEFAULT_FILE_SORT_COLUMN ||
    state.sortDirection !== defaultFileDirectionFor(DEFAULT_FILE_SORT_COLUMN)
  ) {
    params.set('sortBy', state.sortBy);
    params.set('sortDirection', state.sortDirection);
  }
  if (state.page !== 1) params.set('page', String(state.page));
  if (state.pageSize !== DEFAULT_FILE_PAGE_SIZE) {
    params.set('pageSize', String(state.pageSize));
  }
  return params.toString();
}

/** Sorting by `column`: toggles the current column, else that column's default direction. Keeps page and filters. */
export function withFileSort(
  state: FileListState,
  column: FileSortColumn,
): FileListState {
  const sortDirection: SortDirection =
    state.sortBy === column
      ? state.sortDirection === 'Asc'
        ? 'Desc'
        : 'Asc'
      : defaultFileDirectionFor(column);
  return { ...state, sortBy: column, sortDirection };
}

export function withFilePage(
  state: FileListState,
  page: number,
): FileListState {
  return { ...state, page: Math.max(1, page) };
}

/** A new page size always returns to page 1. */
export function withFilePageSize(
  state: FileListState,
  pageSize: FilePageSize,
): FileListState {
  return { ...state, pageSize, page: 1 };
}

/** New filters always return to page 1 and keep the sort. */
export function withFileFilters(
  state: FileListState,
  filters: FileListFilters,
): FileListState {
  return { ...state, filters, page: 1 };
}
