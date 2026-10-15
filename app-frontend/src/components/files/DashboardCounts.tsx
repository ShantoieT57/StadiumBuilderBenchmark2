'use client';

/**
 * The Dashboard summary strip: how many (non-cancelled) files are in each status
 * and how many of their transactions are Imported, Approved and Rejected.
 *
 * - Each count is a link: a file status filters the Dashboard list (keeping the
 *   sort, page size and other filters, back to page 1); a transaction status
 *   opens the Transactions list filtered to it.
 * - Owns its loading / problem states, so the file list beside it never waits.
 * - Refetches in place on the shell's `file-changed`, `transactions-changed` and
 *   `resync` events (no connection of its own).
 * - Counts are shown exactly as the back-end returns them.
 */

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useFileListQuery } from '@/components/files/useFileListQuery';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useEvents } from '@/contexts/EventsContext';
import { getDashboardSummary } from '@/lib/api/endpoints';
import { isNetworkError, isRedirectingToSignIn } from '@/lib/api/errors';
import {
  FILE_STATUSES,
  toFileListSearch,
  withFileFilters,
  type FileListState,
} from '@/lib/files/listQuery';
import { formatFileStatus } from '@/lib/format/file';
import { formatTransactionStatus } from '@/lib/format/transaction';
import {
  parseListState,
  toListSearch,
  TRANSACTION_STATUSES,
  withFilters,
} from '@/lib/transactions/listQuery';
import type {
  DashboardSummary,
  FileStatus,
  FileStatusCounts,
  TransactionStatus,
  TransactionStatusCounts,
} from '@/types/api-generated';

export const LOADING_COUNTS_MESSAGE = 'Loading counts';
export const COUNTS_LOAD_FAILED_TITLE = 'Counts could not be loaded';
const LOAD_FAILED_MESSAGE = 'Something went wrong. Please try again.';
const UNREACHABLE_MESSAGE =
  "We can't reach the app right now. Check your connection and try again.";
const DASHBOARD_PATH = '/dashboard';
const TRANSACTIONS_PATH = '/transactions';

const FILE_COUNT_KEYS: Record<FileStatus, keyof FileStatusCounts> = {
  Uploaded: 'uploaded',
  Processing: 'processing',
  Completed: 'completed',
  Failed: 'failed',
};

const TRANSACTION_COUNT_KEYS: Record<
  TransactionStatus,
  keyof TransactionStatusCounts
> = {
  Imported: 'imported',
  Approved: 'approved',
  Rejected: 'rejected',
};

/** The Dashboard filtered to one file status: other filters and the sort kept, page 1. */
function fileStatusHref(view: FileListState, status: FileStatus): string {
  const search = toFileListSearch(
    withFileFilters(view, { ...view.filters, status }),
  );
  return search ? `${DASHBOARD_PATH}?${search}` : DASHBOARD_PATH;
}

/** The Transactions list filtered to one status (its default view otherwise). */
function transactionStatusHref(status: TransactionStatus): string {
  const search = toListSearch(
    withFilters(parseListState(new URLSearchParams()), { status }),
  );
  return search ? `${TRANSACTIONS_PATH}?${search}` : TRANSACTIONS_PATH;
}

interface CountItem {
  key: string;
  count: number;
  word: string;
  href: string;
}

function CountGroup({
  title,
  listLabel,
  columnsClassName,
  items,
}: {
  title: string;
  listLabel: string;
  /** Grid columns from `sm` up (two per row on a phone). */
  columnsClassName: string;
  items: CountItem[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h2 className="text-base font-semibold">{title}</h2>
      <ul
        aria-label={listLabel}
        className={`grid grid-cols-2 gap-2 ${columnsClassName}`}
      >
        {items.map((item) => (
          <li key={item.key} className="min-w-0">
            <Link
              href={item.href}
              className="bg-card text-card-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 flex min-w-0 flex-col rounded-lg border p-3 outline-none focus-visible:ring-[3px]"
            >
              <span className="text-2xl font-semibold tabular-nums">
                {item.count}
              </span>{' '}
              <span className="text-sm break-words">{item.word}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DashboardCounts() {
  const { view } = useFileListQuery();
  const { subscribe } = useEvents();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const requestRef = useRef(0);

  // State is only set from the promise callbacks, never synchronously in an effect.
  const load = useCallback((): Promise<void> => {
    const request = ++requestRef.current;
    return getDashboardSummary().then(
      (next) => {
        if (request !== requestRef.current) return;
        setSummary(next);
        setFailure(null);
      },
      (error: unknown) => {
        if (request !== requestRef.current) return;
        if (isRedirectingToSignIn(error)) return;
        setFailure(error ?? new Error('Load failed'));
      },
    );
  }, []);

  useEffect(() => {
    void load();
    // Ignore answers that arrive after the strip has gone.
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  // Live refresh: refetch in place, keeping the current counts on screen.
  useEffect(() => {
    const refresh = () => {
      void load();
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
    setSummary(null);
    void load();
  };

  let content: ReactNode;
  if (failure !== null) {
    content = (
      <Alert variant="destructive">
        <AlertTitle>{COUNTS_LOAD_FAILED_TITLE}</AlertTitle>
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
  } else if (summary === null) {
    content = (
      <p role="status" className="text-muted-foreground">
        {LOADING_COUNTS_MESSAGE}…
      </p>
    );
  } else {
    const fileItems: CountItem[] = FILE_STATUSES.map((status) => ({
      key: status,
      count: summary.files[FILE_COUNT_KEYS[status]],
      word: formatFileStatus(status),
      href: fileStatusHref(view, status),
    }));
    const transactionItems: CountItem[] = TRANSACTION_STATUSES.map(
      (status) => ({
        key: status,
        count: summary.transactions[TRANSACTION_COUNT_KEYS[status]],
        word: formatTransactionStatus(status),
        href: transactionStatusHref(status),
      }),
    );
    content = (
      <div className="flex min-w-0 flex-col gap-4 md:flex-row md:gap-6">
        <div className="min-w-0 md:flex-[4]">
          <CountGroup
            title="Files"
            listLabel="File counts"
            columnsClassName="sm:grid-cols-4"
            items={fileItems}
          />
        </div>
        <div className="min-w-0 md:flex-[3]">
          <CountGroup
            title="Transactions"
            listLabel="Transaction counts"
            columnsClassName="sm:grid-cols-3"
            items={transactionItems}
          />
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Dashboard summary" className="min-w-0">
      {content}
    </section>
  );
}
