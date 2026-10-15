'use client';

/**
 * File details (R7, R9-R12, R16-R18).
 *
 * - Header: file name, status in words, who uploaded it and when, last processed,
 *   and a reserved actions area (empty in this epic).
 * - Row summary: total / loaded / skipped / ignored, shown exactly as returned (BR5).
 * - Transaction counts link to the Transactions list for this file and status.
 * - "This file is fully reviewed" follows `isFullyReviewed` only, never the counts (BR6).
 * - Processing history: every stage in the order returned, times to the second.
 * - Loading, problem + Retry (reloads in place) and not-found (404) states (NFR-2).
 * - "Back to dashboard" returns to the remembered Dashboard view (BR2).
 */

import Link from 'next/link';
import { ArrowLeftIcon } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import {
  FileCancelledBadge,
  FileStatusBadge,
} from '@/components/files/FileStatusBadge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getFile } from '@/lib/api/endpoints';
import {
  isNetworkError,
  isRedirectingToSignIn,
  statusOf,
} from '@/lib/api/errors';
import {
  dashboardListHref,
  rememberedFileListSearch,
} from '@/lib/files/listReturn';
import {
  formatLastProcessed,
  formatProcessingStage,
  formatRowCount,
} from '@/lib/format/file';
import {
  formatLocalDateTime,
  formatLocalDateTimeWithSeconds,
  formatTransactionStatus,
} from '@/lib/format/transaction';
import {
  parseListState,
  toListSearch,
  withFilters,
} from '@/lib/transactions/listQuery';
import type {
  FileDetails,
  ProcessingStageEntry,
  TransactionStatus,
} from '@/types/api-generated';

export const LOADING_FILE_MESSAGE = 'Loading file';
export const FILE_NOT_FOUND_TITLE = 'File not found';
export const FULLY_REVIEWED_MESSAGE = 'This file is fully reviewed';
export const STAGE_IN_PROGRESS = 'In progress';
const LOAD_FAILED_TITLE = 'The file could not be loaded';
const LOAD_FAILED_MESSAGE = 'Something went wrong. Please try again.';
const UNREACHABLE_MESSAGE =
  "We can't reach the app right now. Check your connection and try again.";

const noSubscription = () => () => {};

/** The Transactions list filtered to one file and one status. */
export function fileTransactionsHref(
  fileId: string,
  status: TransactionStatus,
): string {
  const view = withFilters(parseListState(new URLSearchParams()), {
    fileId,
    status,
  });
  return `/transactions?${toListSearch(view)}`;
}

/** "Back to dashboard", returning to the Dashboard view remembered for this tab. */
function BackToDashboard() {
  const search = useSyncExternalStore(
    noSubscription,
    rememberedFileListSearch,
    () => '',
  );
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
      <Link href={dashboardListHref(search)}>
        <ArrowLeftIcon aria-hidden="true" />
        Back to dashboard
      </Link>
    </Button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="text-muted-foreground text-sm font-medium sm:w-64 sm:shrink-0">
        {label}
      </dt>
      <dd className="min-w-0 break-words tabular-nums">{children}</dd>
    </div>
  );
}

/** Section wrapper with a visible heading that names it. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id={headingId} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function FileHeader({ file }: { file: FileDetails }) {
  return (
    <header className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-2xl font-semibold break-all">{file.fileName}</h1>
          <div className="flex flex-wrap items-center gap-1">
            <FileStatusBadge status={file.status} />
            {file.isCancelled && <FileCancelledBadge />}
          </div>
        </div>
        {/* Header actions area: reserved for the importer's Cancel and Correct
            actions (a later epic). Empty for both roles in this epic. */}
        <div className="flex flex-wrap gap-2" data-slot="file-actions" />
      </div>
      <dl className="flex min-w-0 flex-col gap-2 text-sm">
        <Field label="Uploaded by">{file.uploadedBy}</Field>
        <Field label="Uploaded on">
          {formatLocalDateTime(file.uploadedAt)}
        </Field>
        <Field label="Last processed">
          {formatLastProcessed(file.lastProcessedAt)}
        </Field>
      </dl>
    </header>
  );
}

function RowSummary({ file }: { file: FileDetails }) {
  return (
    <Section title="Rows">
      <dl className="flex min-w-0 flex-col gap-3">
        <Field label="Total rows">{formatRowCount(file.rowCount)}</Field>
        <Field label="Loaded">{formatRowCount(file.loadedCount)}</Field>
        <Field label="Skipped – reference already existed">
          {formatRowCount(file.skippedExistingCount)}
        </Field>
        <Field label="Ignored – empty reference">
          {formatRowCount(file.ignoredEmptyReferenceCount)}
        </Field>
      </dl>
    </Section>
  );
}

function TransactionCounts({ file }: { file: FileDetails }) {
  const counts: { status: TransactionStatus; count: number }[] = [
    { status: 'Imported', count: file.transactions.imported },
    { status: 'Approved', count: file.transactions.approved },
    { status: 'Rejected', count: file.transactions.rejected },
  ];
  return (
    <Section title="Transactions">
      <ul className="flex flex-wrap gap-2">
        {counts.map(({ status, count }) => {
          const label = `${count} ${formatTransactionStatus(status)}`;
          return (
            <li key={status}>
              {file.areTransactionsAvailable ? (
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={fileTransactionsHref(file.id, status)}
                    className="tabular-nums"
                  >
                    {label}
                  </Link>
                </Button>
              ) : (
                <span className="tabular-nums">{label}</span>
              )}
            </li>
          );
        })}
      </ul>
      {/* Not-available-yet message (areTransactionsAvailable false) goes here. */}
      {file.isFullyReviewed && (
        <p className="text-success font-medium">{FULLY_REVIEWED_MESSAGE}</p>
      )}
    </Section>
  );
}

function stageTime(value: string | null): string {
  return value === null
    ? STAGE_IN_PROGRESS
    : formatLocalDateTimeWithSeconds(value);
}

function ProcessingHistory({ stages }: { stages: ProcessingStageEntry[] }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id={headingId} className="text-lg font-semibold">
        Processing history
      </h2>
      {stages.length === 0 ? (
        <p className="text-muted-foreground">Not processed yet.</p>
      ) : (
        <Table aria-labelledby={headingId}>
          <TableHeader>
            <TableRow>
              <TableHead>Stage</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Finished</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stages.map((entry, index) => (
              <TableRow key={`${entry.stage}-${index}`}>
                <TableCell className="whitespace-normal">
                  {formatProcessingStage(entry.stage)}
                </TableCell>
                <TableCell className="whitespace-normal tabular-nums">
                  {stageTime(entry.startedAt)}
                </TableCell>
                <TableCell className="whitespace-normal tabular-nums">
                  {stageTime(entry.finishedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function FileDetailsContent({ file }: { file: FileDetails }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <FileHeader file={file} />
      {/* Failure reason panel ("Why it failed", status Failed) goes here. */}
      {/* Cancelled information (when and by whom) goes here. */}
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <RowSummary file={file} />
        <TransactionCounts file={file} />
      </div>
      <ProcessingHistory stages={file.processingHistory} />
      {/* Download original button (canDownload) goes here. */}
    </div>
  );
}

export function FileDetailsView({ fileId }: { fileId: string }) {
  const [file, setFile] = useState<FileDetails | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const requestRef = useRef(0);

  // State is only set from the promise callbacks, never synchronously in an effect.
  const load = useCallback((): Promise<void> => {
    const request = ++requestRef.current;
    return getFile(fileId).then(
      (result) => {
        if (request !== requestRef.current) return;
        setFile(result);
        setFailure(null);
      },
      (error: unknown) => {
        if (request !== requestRef.current) return;
        if (isRedirectingToSignIn(error)) return;
        setFailure(error ?? new Error('Load failed'));
      },
    );
  }, [fileId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Ignore answers that arrive after the screen has gone.
  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    [],
  );

  const retry = () => {
    setFailure(null);
    setFile(null);
    void load();
  };

  let content: ReactNode;
  if (failure !== null && statusOf(failure) === 404) {
    content = (
      <>
        <h1 className="text-2xl font-semibold">{FILE_NOT_FOUND_TITLE}</h1>
        <p className="text-muted-foreground">
          This file does not exist or is no longer available.
        </p>
      </>
    );
  } else if (failure !== null) {
    content = (
      <>
        <h1 className="text-2xl font-semibold">File details</h1>
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
      </>
    );
  } else if (file === null) {
    content = (
      <>
        <h1 className="text-2xl font-semibold">File details</h1>
        <p role="status" className="text-muted-foreground">
          {LOADING_FILE_MESSAGE}…
        </p>
      </>
    );
  } else {
    content = <FileDetailsContent file={file} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <BackToDashboard />
      {content}
    </div>
  );
}
