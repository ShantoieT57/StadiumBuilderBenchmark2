'use client';

/**
 * The Dashboard file list.
 *
 * - The view (sort, page, page size, filters) lives in the URL search params, so
 *   reload, Back and links restore it. Changing it pushes a new URL.
 * - Desktop (md and up) shows a table; narrow screens show compact rows with the
 *   key details and an actions area holding the details link.
 * - Refetches in place on the shell's `file-changed`, `transactions-changed` and
 *   `resync` events, keeping the current view (no connection of its own).
 * - Only file names and counts are shown; nothing is written to the console.
 */

import Link from 'next/link';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  FileCancelledBadge,
  FileStatusBadge,
} from '@/components/files/FileStatusBadge';
import { useFileListQuery } from '@/components/files/useFileListQuery';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useEvents } from '@/contexts/EventsContext';
import { getFiles } from '@/lib/api/endpoints';
import { isNetworkError, isRedirectingToSignIn } from '@/lib/api/errors';
import { activeFileFilters } from '@/lib/files/activeFilters';
import {
  FILE_PAGE_SIZES,
  hasFileFilters,
  toFileListSearch,
  toFilesQuery,
  withFileFilters,
  withFilePage,
  withFilePageSize,
  withFileSort,
  type FileListFilters,
  type FileListState,
  type FilePageSize,
} from '@/lib/files/listQuery';
import { rememberFileListSearch } from '@/lib/files/listReturn';
import { formatLastProcessed, formatRowCount } from '@/lib/format/file';
import type {
  FileListItem,
  FilePage,
  FileSortColumn,
  ListFilesQuery,
  UserRole,
} from '@/types/api-generated';

export const LOADING_FILES_MESSAGE = 'Loading files';
export const NO_FILES_MESSAGE = 'No files yet';
export const NO_MATCHING_FILES_MESSAGE = 'No files match your filters';
/** Shown while a changed view (sort, page, filters) loads over the previous rows. */
export const UPDATING_MESSAGE = 'Updating…';
export const FILES_LOAD_FAILED_TITLE = 'Files could not be loaded';
const LOAD_FAILED_MESSAGE = 'Something went wrong. Please try again.';
const UNREACHABLE_MESSAGE =
  "We can't reach the app right now. Check your connection and try again.";
const UPLOAD_PATH = '/upload';

interface LoadedPage {
  page: FilePage;
  /** The `GET /files` query (as JSON) this page answers. */
  queryKey: string;
}

interface Column {
  sortBy: FileSortColumn;
  label: string;
  className?: string;
}

const COLUMNS: readonly Column[] = [
  { sortBy: 'FileName', label: 'File name' },
  { sortBy: 'LastProcessedAt', label: 'Last processed' },
  { sortBy: 'RowCount', label: 'Rows', className: 'text-right' },
  { sortBy: 'Status', label: 'Status' },
  { sortBy: 'ImportedCount', label: 'Imported', className: 'text-right' },
];

/** Per-row actions (e.g. a later epic's correction shortcut); nothing by default. */
export type FileRowActions = (file: FileListItem) => ReactNode;

/** The details route for a file (under the Dashboard, so its menu item stays current). */
export function fileDetailsHref(id: string): string {
  return `/dashboard/files/${encodeURIComponent(id)}`;
}

function SortIcon({
  active,
  ascending,
}: {
  active: boolean;
  ascending: boolean;
}) {
  if (!active)
    return (
      <ArrowUpDownIcon aria-hidden="true" className="size-3.5 opacity-50" />
    );
  return ascending ? (
    <ArrowUpIcon aria-hidden="true" className="size-3.5" />
  ) : (
    <ArrowDownIcon aria-hidden="true" className="size-3.5" />
  );
}

function StatusCell({ file }: { file: FileListItem }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <FileStatusBadge status={file.status} />
      {file.isCancelled && <FileCancelledBadge />}
    </div>
  );
}

function FilesTable({
  items,
  view,
  onSort,
  rowActions,
}: {
  items: FileListItem[];
  view: FileListState;
  onSort: (column: FileSortColumn) => void;
  rowActions?: FileRowActions;
}) {
  return (
    <div className="hidden md:block">
      <Table>
        <TableCaption className="sr-only">Files</TableCaption>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((column) => {
              const active = view.sortBy === column.sortBy;
              const ascending = view.sortDirection === 'Asc';
              return (
                <TableHead
                  key={column.sortBy}
                  className={column.className}
                  aria-sort={
                    active
                      ? ascending
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2 h-8 px-2"
                    onClick={() => onSort(column.sortBy)}
                  >
                    {column.label}
                    <SortIcon active={active} ascending={ascending} />
                  </Button>
                </TableHead>
              );
            })}
            {rowActions && (
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((file) => (
            <TableRow key={file.id}>
              <TableCell className="max-w-72 font-medium whitespace-normal break-all">
                <Link
                  href={fileDetailsHref(file.id)}
                  className="text-primary underline-offset-4 hover:underline focus-visible:ring-ring/50 rounded-sm outline-none focus-visible:ring-[3px]"
                >
                  {file.fileName}
                </Link>
              </TableCell>
              <TableCell>{formatLastProcessed(file.lastProcessedAt)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatRowCount(file.rowCount)}
              </TableCell>
              <TableCell>
                <StatusCell file={file} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {file.importedCount}
              </TableCell>
              {rowActions && <TableCell>{rowActions(file)}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function FilesCompactList({
  items,
  rowActions,
}: {
  items: FileListItem[];
  rowActions?: FileRowActions;
}) {
  return (
    <ul aria-label="Files" className="flex flex-col gap-2 md:hidden">
      {items.map((file) => (
        <li
          key={file.id}
          className="bg-card flex min-w-0 flex-col gap-2 rounded-lg border p-3 text-sm"
        >
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 font-medium break-all">
              {file.fileName}
            </span>
            <StatusCell file={file} />
          </div>
          <div className="text-muted-foreground">
            {formatLastProcessed(file.lastProcessedAt)}
          </div>
          <div className="tabular-nums">Imported: {file.importedCount}</div>
          {/* Row actions: the details link first, then any per-row actions. */}
          <div className="flex flex-wrap justify-end gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={fileDetailsHref(file.id)}>
                Details<span className="sr-only"> for {file.fileName}</span>
              </Link>
            </Button>
            {rowActions?.(file)}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Filters that match no file: the active filters and one action to clear them. */
function NoMatch({
  filters,
  onClear,
}: {
  filters: FileListFilters;
  onClear: () => void;
}) {
  const headingId = useId();
  const entries = activeFileFilters(filters);
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id={headingId} className="text-lg font-semibold">
        {NO_MATCHING_FILES_MESSAGE}
      </h2>
      <p className="text-muted-foreground text-sm">Filters in use:</p>
      <ul
        aria-label="Filters in use"
        className="flex list-disc flex-col gap-1 pl-5 text-sm break-all"
      >
        {entries.map((entry) => (
          <li key={entry.key}>{entry.text}</li>
        ))}
      </ul>
      <div>
        <Button type="button" variant="outline" onClick={onClear}>
          Clear all filters
        </Button>
      </div>
    </section>
  );
}

function Paging({
  result,
  view,
  onPage,
  onPageSize,
}: {
  result: FilePage;
  view: FileListState;
  onPage: (page: number) => void;
  onPageSize: (pageSize: FilePageSize) => void;
}) {
  const pageSizeId = useId();
  const totalPages = Math.max(result.totalPages, 1);
  const page = Math.min(result.page, totalPages);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2">
        <Label htmlFor={pageSizeId}>Rows per page</Label>
        <Select
          value={String(view.pageSize)}
          onValueChange={(value) => {
            const size = FILE_PAGE_SIZES.find(
              (option) => String(option) === value,
            );
            if (size) onPageSize(size);
          }}
        >
          <SelectTrigger id={pageSizeId} size="sm" className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILE_PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-muted-foreground" aria-live="polite">
        Page {page} of {totalPages} ({result.totalCount}{' '}
        {result.totalCount === 1 ? 'file' : 'files'})
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous page
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next page
        </Button>
      </div>
    </div>
  );
}

export interface FilesListProps {
  /** The signed-in role: only an Importer is offered the Upload link. */
  role: UserRole;
  /** Reserved per-row action slot; renders nothing unless given. */
  rowActions?: FileRowActions;
}

export function FilesList({ role, rowActions }: FilesListProps) {
  const { view, navigate } = useFileListQuery();
  const { subscribe } = useEvents();

  const query = useMemo(() => toFilesQuery(view), [view]);
  const queryKey = useMemo(() => JSON.stringify(query), [query]);

  // The last page received, with the query it answers: while it answers an
  // older query the rows stay in place and the list shows it is updating.
  const [loaded, setLoaded] = useState<LoadedPage | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const queryRef = useRef<ListFilesQuery>(query);
  const requestRef = useRef(0);

  // State is only ever set from the promise callbacks (after the response
  // arrives), never synchronously while an effect is running.
  const load = useCallback((params: ListFilesQuery): Promise<void> => {
    const request = ++requestRef.current;
    return getFiles(params).then(
      (page) => {
        if (request !== requestRef.current) return;
        setLoaded({ page, queryKey: JSON.stringify(params) });
        setFailure(null);
      },
      (error: unknown) => {
        if (request !== requestRef.current) return;
        if (isRedirectingToSignIn(error)) return;
        setFailure(error ?? new Error('Load failed'));
      },
    );
  }, []);

  // Remember the view so the details screen's back link returns to it.
  const listSearch = useMemo(() => toFileListSearch(view), [view]);
  useEffect(() => {
    rememberFileListSearch(listSearch);
  }, [listSearch]);

  useEffect(() => {
    queryRef.current = query;
    void load(query);
  }, [query, load]);

  // Ignore answers that arrive after the list has gone.
  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    [],
  );

  // Live refresh: refetch in place with the current view.
  useEffect(() => {
    const refresh = () => {
      void load(queryRef.current);
    };
    const unsubscribers = [
      subscribe('file-changed', refresh),
      subscribe('transactions-changed', refresh),
      subscribe('resync', refresh),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [subscribe, load]);

  const retry = () => {
    setFailure(null);
    void load(queryRef.current);
  };

  const result = loaded?.page ?? null;
  const showUpdates = loaded !== null && failure === null;
  const updating = showUpdates && loaded.queryKey !== queryKey;
  const filtered = hasFileFilters(view.filters);

  let content: ReactNode;
  if (failure !== null) {
    content = (
      <Alert variant="destructive">
        <AlertTitle>{FILES_LOAD_FAILED_TITLE}</AlertTitle>
        <AlertDescription>
          <p>
            {isNetworkError(failure)
              ? UNREACHABLE_MESSAGE
              : LOAD_FAILED_MESSAGE}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={retry}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  } else if (result === null) {
    content = (
      <p role="status" className="text-muted-foreground">
        {LOADING_FILES_MESSAGE}…
      </p>
    );
  } else if (result.totalCount === 0 && !filtered) {
    content = (
      <div className="flex flex-col items-start gap-2">
        <p className="text-muted-foreground">{NO_FILES_MESSAGE}</p>
        {role === 'Importer' && (
          <Button asChild variant="outline" size="sm">
            <Link href={UPLOAD_PATH}>Upload a file</Link>
          </Button>
        )}
      </div>
    );
  } else if (result.totalCount === 0) {
    content = (
      <NoMatch
        filters={view.filters}
        onClear={() => navigate(withFileFilters(view, {}))}
      />
    );
  } else if (result.items.length === 0) {
    // Past the last page (an old link, or files removed by a live refresh):
    // offer a way back rather than leaving the list with no paging controls.
    const lastPage = Math.max(result.totalPages, 1);
    content = (
      <div className="flex flex-col items-start gap-2">
        <p className="text-muted-foreground">
          There are no files on this page.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => navigate(withFilePage(view, lastPage))}
        >
          Go to last page
        </Button>
      </div>
    );
  } else {
    content = (
      <>
        <FilesTable
          items={result.items}
          view={view}
          onSort={(column) => navigate(withFileSort(view, column))}
          rowActions={rowActions}
        />
        <FilesCompactList items={result.items} rowActions={rowActions} />
        <Paging
          result={result}
          view={view}
          onPage={(page) => navigate(withFilePage(view, page))}
          onPageSize={(size) => navigate(withFilePageSize(view, size))}
        />
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {/* Always present once loaded (a live region announces changes), and a
          fixed height so the rows below do not move when it fills. */}
      {showUpdates && (
        <p role="status" className="text-muted-foreground min-h-5 text-sm">
          {updating ? UPDATING_MESSAGE : null}
        </p>
      )}
      <div
        aria-busy={updating ? true : undefined}
        className="flex min-w-0 flex-col gap-4"
      >
        {content}
      </div>
    </div>
  );
}
