'use client';

/**
 * The transactions list (TL-01..03, TL-08, GN-01).
 *
 * - The view (sort, page, page size, filters) lives in the URL search params, so
 *   reload, Back and links restore it (BR2). Changing it pushes a new URL.
 * - Desktop (md and up) shows a table; narrow screens show compact rows with the
 *   key details and an actions area holding the details link.
 * - For an Approver (`role`), every Imported row offers Approve and Reject (a
 *   last "Actions" column on desktop, after "Details" on phones). A decision's
 *   answer replaces the row at once, then the view is refetched in place; focus
 *   then moves to the row's details link, or to the results when the row has
 *   left the view.
 * - When a live refresh would take away the row behind an open Approve / Reject
 *   (no longer Imported, or gone from the view), the transaction is fetched once
 *   first. If someone else decided it, the dialog closes and the same lasting
 *   problem as a 409 says so, with the current status (and reason); nothing is
 *   sent (BR2, R9, R14). If it is still Imported and only left the view, the
 *   dialog closes quietly with the row. A refresh that arrives while a decision is being sent waits
 *   until its answer is in, so the decision's own answer (200 or 409) speaks.
 * - Refetches in place on the shell's `transactions-changed` and `resync` events,
 *   keeping the current view (NFR-5: no connection of its own).
 * - A failed first load replaces the list with a problem + Retry; a failed later
 *   load keeps the rows on screen with a small "Couldn't refresh" notice + Retry.
 * - Account numbers and descriptions are never logged (BR8): failures are shown
 *   without the error body and nothing is written to the console.
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

import { RefreshFailedNotice } from '@/components/feedback/RefreshFailedNotice';
import {
  decidedElsewhereToast,
  toTransactionListItem,
  type DecisionActivity,
} from '@/components/transactions/decisionConflict';
import { TransactionRowActions } from '@/components/transactions/TransactionRowActions';
import { TransactionStatusBadge } from '@/components/transactions/TransactionStatusBadge';
import {
  fileNameFor,
  useFileOptions,
} from '@/components/transactions/useFileOptions';
import { useListQuery } from '@/components/transactions/useListQuery';
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
import { useImportedCount } from '@/contexts/ImportedCountContext';
import { useToast } from '@/contexts/ToastContext';
import { getTransaction, getTransactions } from '@/lib/api/endpoints';
import { isNetworkError, isRedirectingToSignIn } from '@/lib/api/errors';
import {
  formatAmount,
  formatTransactionDate,
  formatTransactionType,
} from '@/lib/format/transaction';
import {
  activeFilters,
  hasActiveFilters,
} from '@/lib/transactions/activeFilters';
import {
  TRANSACTION_PAGE_SIZES,
  toListSearch,
  toTransactionsQuery,
  withFilters,
  withPage,
  withPageSize,
  withSort,
  type TransactionListFilters,
  type TransactionListState,
  type TransactionPageSize,
} from '@/lib/transactions/listQuery';
import { rememberListSearch } from '@/lib/transactions/listReturn';
import type {
  ListTransactionsQuery,
  TransactionDetails,
  TransactionListItem,
  TransactionPage,
  TransactionSortColumn,
  UserRole,
} from '@/types/api-generated';

export const LOADING_TRANSACTIONS_MESSAGE = 'Loading transactions';
export const NO_TRANSACTIONS_MESSAGE = 'No transactions yet';
export const NO_MATCH_TITLE = 'No transactions match your filters';
/** Shown while a changed view (sort, page, filters) loads over the previous rows. */
export const UPDATING_MESSAGE = 'Updating…';
export const LOAD_FAILED_TITLE = 'Transactions could not be loaded';
const LOAD_FAILED_MESSAGE = 'Something went wrong. Please try again.';
const UNREACHABLE_MESSAGE =
  "We can't reach the app right now. Check your connection and try again.";

interface LoadedPage {
  page: TransactionPage;
  /** The `GET /transactions` query (as JSON) this page answers. */
  queryKey: string;
}

interface Column {
  sortBy: TransactionSortColumn;
  label: string;
  className?: string;
}

const COLUMNS: readonly Column[] = [
  { sortBy: 'Reference', label: 'Reference' },
  { sortBy: 'TransactionDate', label: 'Date' },
  { sortBy: 'AccountNumber', label: 'Account' },
  { sortBy: 'Description', label: 'Description' },
  { sortBy: 'Amount', label: 'Amount', className: 'text-right' },
  { sortBy: 'TransactionType', label: 'Type' },
  { sortBy: 'Status', label: 'Status' },
  { sortBy: 'FileName', label: 'File' },
];

/**
 * The details route for a transaction. The list's view is not carried in the
 * link: browser Back restores it from the list URL, and the details screen's
 * back link uses the view remembered by `rememberListSearch`.
 */
export function transactionDetailsHref(id: string): string {
  return `/transactions/${encodeURIComponent(id)}`;
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

/**
 * Marks a row's details link (`data-transaction-link`), so focus can return to
 * the row after a decision.
 */
const ROW_LINK_ATTRIBUTE = 'data-transaction-link';

/** Where a decision was made from: the row's id (a new object each time). */
interface FocusRequest {
  transactionId: string;
}

/**
 * After a decision: focus the row's visible details link (table or compact list,
 * whichever is shown), or the results when the row is no longer in the view.
 */
function focusAfterDecision(
  results: HTMLElement | null,
  transactionId: string,
): void {
  if (results === null) return;
  const links = Array.from(
    results.querySelectorAll<HTMLElement>(`[${ROW_LINK_ATTRIBUTE}]`),
  ).filter((link) => link.getAttribute(ROW_LINK_ATTRIBUTE) === transactionId);
  const target =
    links.find((link) => link.getClientRects().length > 0) ?? links[0];
  (target ?? results).focus();
}

/** The Approve / Reject currently open, and whether it is sending. */
interface OpenDecision {
  transactionId: string;
  activity: Exclude<DecisionActivity, 'closed'>;
}

/** Approve / Reject are offered to an Approver on Imported rows only (R1, BR1). */
function canDecide(
  role: UserRole | undefined,
  item: TransactionListItem,
): boolean {
  return role === 'Approver' && item.status === 'Imported';
}

function TransactionsTable({
  items,
  view,
  role,
  onSort,
  onSettled,
  onActivity,
}: {
  items: TransactionListItem[];
  view: TransactionListState;
  role: UserRole | undefined;
  onSort: (column: TransactionSortColumn) => void;
  onSettled: (id: string, details: TransactionDetails | null) => void;
  onActivity: (id: string, activity: DecisionActivity) => void;
}) {
  const showActions = role === 'Approver';
  return (
    <div className="hidden md:block">
      <Table>
        <TableCaption className="sr-only">Transactions</TableCaption>
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
            {showActions && <TableHead>Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">
                <Link
                  href={transactionDetailsHref(item.id)}
                  data-transaction-link={item.id}
                  className="text-primary underline-offset-4 hover:underline focus-visible:ring-ring/50 rounded-sm outline-none focus-visible:ring-[3px]"
                >
                  {item.reference}
                </Link>
              </TableCell>
              <TableCell>
                {formatTransactionDate(item.transactionDate)}
              </TableCell>
              <TableCell>{item.accountNumber}</TableCell>
              <TableCell className="max-w-64 whitespace-normal break-words">
                {item.description}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAmount(item.amount, item.currency)}
              </TableCell>
              <TableCell>
                {formatTransactionType(item.transactionType)}
              </TableCell>
              <TableCell>
                <TransactionStatusBadge status={item.status} />
              </TableCell>
              <TableCell>{item.file.fileName}</TableCell>
              {showActions && (
                <TableCell>
                  {canDecide(role, item) && (
                    <TransactionRowActions
                      item={item}
                      onSettled={(details) => onSettled(item.id, details)}
                      onActivityChange={(activity) =>
                        onActivity(item.id, activity)
                      }
                    />
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TransactionsCompactList({
  items,
  role,
  onSettled,
  onActivity,
}: {
  items: TransactionListItem[];
  role: UserRole | undefined;
  onSettled: (id: string, details: TransactionDetails | null) => void;
  onActivity: (id: string, activity: DecisionActivity) => void;
}) {
  return (
    <ul aria-label="Transactions" className="flex flex-col gap-2 md:hidden">
      {items.map((item) => (
        <li
          key={item.id}
          className="bg-card flex min-w-0 flex-col gap-2 rounded-lg border p-3 text-sm"
        >
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span className="font-medium break-all">{item.reference}</span>
            <TransactionStatusBadge status={item.status} />
          </div>
          <div className="text-muted-foreground">
            {formatTransactionDate(item.transactionDate)}
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="tabular-nums font-medium">
              {formatAmount(item.amount, item.currency)}
            </span>
            <span>{formatTransactionType(item.transactionType)}</span>
          </div>
          {/* Row actions: the details link, then Approve / Reject for an Approver. */}
          <div className="flex flex-wrap justify-end gap-2">
            <Button asChild variant="outline" size="sm">
              <Link
                href={transactionDetailsHref(item.id)}
                data-transaction-link={item.id}
              >
                {'Details '}
                <span className="sr-only">for {item.reference}</span>
              </Link>
            </Button>
            {canDecide(role, item) && (
              <TransactionRowActions
                item={item}
                onSettled={(details) => onSettled(item.id, details)}
                onActivityChange={(activity) => onActivity(item.id, activity)}
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Filters that match nothing (TL-08): the active filters and one action to clear them. */
function NoMatch({
  filters,
  onClear,
}: {
  filters: TransactionListFilters;
  onClear: () => void;
}) {
  const headingId = useId();
  // Only look up file names when a file filter needs one.
  const { files } = useFileOptions(filters.fileId !== undefined);
  const entries = activeFilters(filters, (fileId) =>
    fileNameFor(files, fileId),
  );
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id={headingId} className="text-lg font-semibold">
        {NO_MATCH_TITLE}
      </h2>
      <p className="text-muted-foreground text-sm">Filters in use:</p>
      <ul
        aria-label="Filters in use"
        className="flex list-disc flex-col gap-1 pl-5 text-sm break-all"
      >
        {entries.map((entry) => (
          <li key={entry.key}>
            {entry.label}: {entry.value}
          </li>
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
  result: TransactionPage;
  view: TransactionListState;
  onPage: (page: number) => void;
  onPageSize: (pageSize: TransactionPageSize) => void;
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
            const size = TRANSACTION_PAGE_SIZES.find(
              (option) => String(option) === value,
            );
            if (size) onPageSize(size);
          }}
        >
          <SelectTrigger id={pageSizeId} size="sm" className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRANSACTION_PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-muted-foreground" aria-live="polite">
        Page {page} of {totalPages} ({result.totalCount}{' '}
        {result.totalCount === 1 ? 'transaction' : 'transactions'})
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

export function TransactionsList({ role }: { role?: UserRole } = {}) {
  const { view, navigate } = useListQuery();
  const { subscribe } = useEvents();
  const { refreshImportedCount } = useImportedCount();
  const { showToast } = useToast();

  const listSearch = useMemo(() => toListSearch(view), [view]);
  const query = useMemo(() => toTransactionsQuery(view), [view]);
  const queryKey = useMemo(() => JSON.stringify(query), [query]);

  // The last page received, with the query it answers: while it answers an
  // older query the rows stay in place and the list shows it is updating.
  const [loaded, setLoaded] = useState<LoadedPage | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const queryRef = useRef<ListTransactionsQuery>(query);
  const requestRef = useRef(0);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  // The Approve / Reject that is open now (one at a time), and whether a live
  // refresh was held back while it was sending.
  const openDecisionRef = useRef<OpenDecision | null>(null);
  const heldRefreshRef = useRef(false);

  // State is only ever set from the promise callbacks (after the response
  // arrives), never synchronously while an effect is running.
  const load = useCallback(
    (params: ListTransactionsQuery): Promise<void> => {
      const request = ++requestRef.current;
      return getTransactions(params).then(
        (page) => {
          if (request !== requestRef.current) return;
          const apply = () => {
            setLoaded({ page, queryKey: JSON.stringify(params) });
            setFailure(null);
          };
          // Showing this page would take away the row behind the open Approve /
          // Reject (decided by someone else, or gone from the view), closing
          // its dialog. Ask for the transaction first, so the person is told
          // why, with its current status, as a 409 would (R9, R14).
          const open = openDecisionRef.current;
          if (open === null || open.activity !== 'open') {
            apply();
            return;
          }
          const id = open.transactionId;
          const row = page.items.find((item) => item.id === id);
          if (row !== undefined && row.status === 'Imported') {
            apply();
            return;
          }
          return getTransaction(id)
            .then(
              (details): TransactionDetails | null => details,
              () => null,
            )
            .then((details) => {
              if (request !== requestRef.current) return;
              const current = openDecisionRef.current;
              if (
                current?.transactionId === id &&
                current.activity === 'sending'
              ) {
                // Confirmed meanwhile: its answer speaks; refetch after it.
                heldRefreshRef.current = true;
                return;
              }
              const stillOpen = current?.transactionId === id;
              const known = details ?? row ?? null;
              const conflict =
                known === null ? null : decidedElsewhereToast(known);
              if (stillOpen && conflict !== null) {
                openDecisionRef.current = null;
                apply();
                showToast(conflict);
                setFocusRequest({ transactionId: id });
                return;
              }
              // Still Imported but no longer in this view (or unknown): the row,
              // and with it the dialog, goes quietly.
              if (stillOpen) openDecisionRef.current = null;
              apply();
            });
        },
        (error: unknown) => {
          if (request !== requestRef.current) return;
          if (isRedirectingToSignIn(error)) return;
          setFailure(error ?? new Error('Load failed'));
        },
      );
    },
    [showToast],
  );

  // Remember the view so the details screen's back link returns to it.
  useEffect(() => {
    rememberListSearch(listSearch);
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
      // Held while a decision is being sent: its answer speaks first.
      if (openDecisionRef.current?.activity === 'sending') {
        heldRefreshRef.current = true;
        return;
      }
      void load(queryRef.current);
    };
    const unsubscribers = [
      subscribe('transactions-changed', refresh),
      subscribe('resync', refresh),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [subscribe, load]);

  // Once the view has refetched after a decision, put focus back near the row.
  useEffect(() => {
    if (focusRequest === null) return;
    focusAfterDecision(resultsRef.current, focusRequest.transactionId);
  }, [focusRequest]);

  // Tracks the open Approve / Reject; a refresh held back while it was sending
  // is applied once the answer is in.
  const trackDecision = (id: string, activity: DecisionActivity) => {
    if (activity === 'closed') {
      if (openDecisionRef.current?.transactionId === id) {
        openDecisionRef.current = null;
      }
    } else {
      openDecisionRef.current = { transactionId: id, activity };
    }
    if (activity !== 'sending' && heldRefreshRef.current) {
      heldRefreshRef.current = false;
      void load(queryRef.current);
    }
  };

  const retry = () => {
    setFailure(null);
    void load(queryRef.current);
  };

  // After a decision (or a "someone got there first" answer): show the row as
  // the back-end returned it at once, then refetch the current view in place so
  // an active filter drops a row that no longer matches (BR9), and bring the
  // menu's waiting count up to date (BR8). The row's Approve / Reject have gone,
  // so focus moves once the refetch has landed (see focusAfterDecision).
  const settled = (id: string, details: TransactionDetails | null) => {
    if (details !== null) {
      const row = toTransactionListItem(details);
      setLoaded((current) =>
        current === null
          ? current
          : {
              ...current,
              page: {
                ...current.page,
                items: current.page.items.map((item) =>
                  item.id === row.id ? row : item,
                ),
              },
            },
      );
    }
    void load(queryRef.current).then(() => {
      setFocusRequest({ transactionId: id });
    });
    refreshImportedCount();
  };

  const result = loaded?.page ?? null;
  // Once a page has loaded, a failed refresh keeps it on screen with a small
  // notice; only a failed first load replaces the list with the problem.
  const refreshFailed = loaded !== null && failure !== null;
  const updating =
    loaded !== null && failure === null && loaded.queryKey !== queryKey;

  let content: ReactNode;
  if (failure !== null && result === null) {
    content = (
      <Alert variant="destructive">
        <AlertTitle>{LOAD_FAILED_TITLE}</AlertTitle>
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
        {LOADING_TRANSACTIONS_MESSAGE}…
      </p>
    );
  } else if (!result.hasAnyTransactions) {
    content = (
      <p className="text-muted-foreground">{NO_TRANSACTIONS_MESSAGE}</p>
    );
  } else if (result.totalCount === 0 && hasActiveFilters(view.filters)) {
    content = (
      <NoMatch
        filters={view.filters}
        onClear={() => navigate(withFilters(view, {}))}
      />
    );
  } else if (result.items.length === 0) {
    // Past the last page (an old link, or rows removed by a live refresh):
    // offer a way back rather than leaving the list with no paging controls.
    const lastPage = Math.max(result.totalPages, 1);
    content = (
      <div className="flex flex-col items-start gap-2">
        <p className="text-muted-foreground">
          There are no transactions on this page.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => navigate(withPage(view, lastPage))}
        >
          Go to last page
        </Button>
      </div>
    );
  } else {
    content = (
      <>
        <TransactionsTable
          items={result.items}
          view={view}
          role={role}
          onSort={(column) => navigate(withSort(view, column))}
          onSettled={settled}
          onActivity={trackDecision}
        />
        <TransactionsCompactList
          items={result.items}
          role={role}
          onSettled={settled}
          onActivity={trackDecision}
        />
        <Paging
          result={result}
          view={view}
          onPage={(page) => navigate(withPage(view, page))}
          onPageSize={(size) => navigate(withPageSize(view, size))}
        />
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {/* Always present once loaded (a live region announces changes), and a
          fixed height so the rows below do not move when it fills. */}
      {loaded !== null && (
        <p role="status" className="text-muted-foreground min-h-5 text-sm">
          {updating ? UPDATING_MESSAGE : null}
        </p>
      )}
      {refreshFailed && <RefreshFailedNotice onRetry={retry} />}
      {/* Focusable from script only: focus lands here after a decision when the
          decided row has left the view. */}
      <div
        ref={resultsRef}
        tabIndex={-1}
        aria-busy={updating ? true : undefined}
        className="flex min-w-0 flex-col gap-4 outline-none"
      >
        {content}
      </div>
    </div>
  );
}
