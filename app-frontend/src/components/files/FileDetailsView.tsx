'use client';

/**
 * File details (R7, R9-R12, R16-R18).
 *
 * - Header: file name, status in words, who uploaded it and when, last processed,
 *   and an actions area: "Correct invalid rows" for an Importer on a file waiting
 *   for corrections, and "Cancel file" for an Importer on any file not cancelled.
 * - Row summary: total / loaded / skipped / ignored, shown exactly as returned (BR5).
 * - Transaction counts link to the Transactions list for this file and status.
 * - "This file is fully reviewed" follows `isFullyReviewed` only, never the counts (BR6).
 * - Processing history: every stage in the order returned, times to the second.
 * - Loading, problem + Retry (reloads in place) and not-found (404) states (NFR-2).
 *   A failed refresh after the file has loaded keeps it on screen with a small
 *   "Couldn't refresh" notice + Retry (a 404 still shows "File not found").
 * - "Back to dashboard" returns to the remembered Dashboard view (BR2).
 * - Failed: "Why it failed" with the reason verbatim, no retry (R13, BR9).
 * - Transactions not available yet: counts as plain text plus a note (R14, BR8).
 * - Cancelled: when and by whom, original discarded, no download (R15, BR7).
 * - "Download original" (canDownload) through the API client; never shows or
 *   logs the content (NFR-6, NFR-7).
 * - Refetches in place on `file-changed` / `transactions-changed` for this file
 *   and on `resync` (no loading state).
 */

import Link from 'next/link';
import { ArrowLeftIcon, DownloadIcon, PencilIcon } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { RefreshFailedNotice } from '@/components/feedback/RefreshFailedNotice';
import { CancelFileDialog } from '@/components/files/CancelFileDialog';
import { correctionsHref } from '@/components/files/FilesList';
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
import { useEvents } from '@/contexts/EventsContext';
import { useToast } from '@/contexts/ToastContext';
import { downloadFileContent, getFile } from '@/lib/api/endpoints';
import {
  isAPIError,
  isNetworkError,
  isRedirectingToSignIn,
  statusOf,
} from '@/lib/api/errors';
import { saveBlob } from '@/lib/download/saveBlob';
import {
  dashboardListHref,
  rememberedFileListSearch,
} from '@/lib/files/listReturn';
import {
  formatLastProcessed,
  formatProcessingStage,
  formatRowCount,
  isWaitingForCorrections,
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
  UserRole,
} from '@/types/api-generated';

export const LOADING_FILE_MESSAGE = 'Loading file';
export const FILE_NOT_FOUND_TITLE = 'File not found';
export const FULLY_REVIEWED_MESSAGE = 'This file is fully reviewed';
export const STAGE_IN_PROGRESS = 'In progress';
const LOAD_FAILED_TITLE = 'The file could not be loaded';
const LOAD_FAILED_MESSAGE = 'Something went wrong. Please try again.';
const UNREACHABLE_MESSAGE =
  "We can't reach the app right now. Check your connection and try again.";
export const NOT_AVAILABLE_YET_MESSAGE =
  "This file's transactions are not available yet.";
export const FAILURE_REASON_TITLE = 'Why it failed';
export const ORIGINAL_DISCARDED_MESSAGE =
  'The original file was discarded when the file was cancelled, so it can no longer be downloaded.';
export const DOWNLOAD_ORIGINAL_LABEL = 'Download original';
export const DOWNLOAD_STARTED_MESSAGE = 'Download started';
const DOWNLOAD_FAILED_TITLE = 'The file could not be downloaded';
export const DOWNLOAD_DISCARDED_MESSAGE =
  'The original file is no longer available because the file was cancelled.';

/** The problem wording for a failed download: the actual error, never the content. */
function downloadProblemMessage(error: unknown): string {
  if (statusOf(error) === 410) return DOWNLOAD_DISCARDED_MESSAGE;
  if (isNetworkError(error)) return UNREACHABLE_MESSAGE;
  if (isAPIError(error) && error.message.trim() !== '') return error.message;
  return LOAD_FAILED_MESSAGE;
}

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

function FileHeader({
  file,
  role,
  onCancelled,
  onRefused,
}: {
  file: FileDetails;
  role: UserRole;
  onCancelled: (details: FileDetails) => void;
  onRefused: () => void;
}) {
  const canCorrect = role === 'Importer' && isWaitingForCorrections(file);
  const canCancel = role === 'Importer' && !file.isCancelled;
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
        {/* Header actions area: the importer's file actions (hidden, never disabled). */}
        <div className="flex flex-wrap gap-2" data-slot="file-actions">
          {canCorrect && (
            <Button asChild>
              <Link href={correctionsHref(file.id)}>
                <PencilIcon aria-hidden="true" />
                Correct invalid rows
              </Link>
            </Button>
          )}
          {canCancel && (
            <CancelFileDialog
              file={file}
              onCancelled={onCancelled}
              onRefused={onRefused}
            />
          )}
        </div>
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
      {!file.areTransactionsAvailable && (
        <p className="text-muted-foreground">{NOT_AVAILABLE_YET_MESSAGE}</p>
      )}
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

/** "Why it failed": the back-end's reason, verbatim. No retry (BR9). */
function FailureReason({ reason }: { reason: string | null }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{FAILURE_REASON_TITLE}</AlertTitle>
      <AlertDescription>
        <p>{reason ?? 'No reason was given.'}</p>
      </AlertDescription>
    </Alert>
  );
}

/** When and by whom the file was cancelled; the original is no longer available. */
function CancelledNotice({ file }: { file: FileDetails }) {
  const when =
    file.cancelledAt !== null ? formatLocalDateTime(file.cancelledAt) : null;
  const by = file.cancelledBy !== null ? ` by ${file.cancelledBy}` : '';
  return (
    <Alert>
      <AlertTitle>This file was cancelled</AlertTitle>
      <AlertDescription>
        {when !== null && <p>{`Cancelled on ${when}${by}`}</p>}
        <p>{ORIGINAL_DISCARDED_MESSAGE}</p>
      </AlertDescription>
    </Alert>
  );
}

/** "Download original": saves the uploaded file under its name (NFR-6, NFR-7). */
function DownloadOriginal({ file }: { file: FileDetails }) {
  const { showToast } = useToast();
  const [downloading, setDownloading] = useState(false);

  const download = () => {
    setDownloading(true);
    downloadFileContent(file.id).then(
      (blob) => {
        setDownloading(false);
        saveBlob(blob, file.fileName);
        showToast({ variant: 'success', title: DOWNLOAD_STARTED_MESSAGE });
      },
      (error: unknown) => {
        setDownloading(false);
        if (isRedirectingToSignIn(error)) return;
        showToast({
          variant: 'error',
          title: DOWNLOAD_FAILED_TITLE,
          message: downloadProblemMessage(error),
        });
      },
    );
  };

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        onClick={download}
        disabled={downloading}
      >
        <DownloadIcon aria-hidden="true" />
        {DOWNLOAD_ORIGINAL_LABEL}
      </Button>
    </div>
  );
}

function FileDetailsContent({
  file,
  role,
  onCancelled,
  onRefused,
}: {
  file: FileDetails;
  role: UserRole;
  onCancelled: (details: FileDetails) => void;
  onRefused: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <FileHeader
        file={file}
        role={role}
        onCancelled={onCancelled}
        onRefused={onRefused}
      />
      {file.status === 'Failed' && (
        <FailureReason reason={file.failureReason} />
      )}
      {file.isCancelled && <CancelledNotice file={file} />}
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <RowSummary file={file} />
        <TransactionCounts file={file} />
      </div>
      <ProcessingHistory stages={file.processingHistory} />
      {file.canDownload && <DownloadOriginal file={file} />}
    </div>
  );
}

export function FileDetailsView({
  fileId,
  role,
}: {
  fileId: string;
  role: UserRole;
}) {
  // The last details received; only shown while they are for this file.
  const [loaded, setLoaded] = useState<{
    fileId: string;
    file: FileDetails;
  } | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const file = loaded !== null && loaded.fileId === fileId ? loaded.file : null;
  const requestRef = useRef(0);

  // State is only set from the promise callbacks, never synchronously in an effect.
  const load = useCallback((): Promise<void> => {
    const request = ++requestRef.current;
    return getFile(fileId).then(
      (result) => {
        if (request !== requestRef.current) return;
        setLoaded({ fileId, file: result });
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

  // Live refresh in place: updates for this file, and resync after a gap.
  const { subscribe } = useEvents();
  useEffect(() => {
    const refreshIfThisFile = (event: { fileId: string }) => {
      if (event.fileId === fileId) void load();
    };
    const unsubscribers = [
      subscribe('file-changed', refreshIfThisFile),
      subscribe('transactions-changed', refreshIfThisFile),
      subscribe('resync', () => {
        void load();
      }),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [subscribe, load, fileId]);

  // Ignore answers that arrive after the screen has gone.
  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    [],
  );

  // Keeps the file already shown: Retry after a failed refresh reloads in place.
  const retry = () => {
    setFailure(null);
    void load();
  };

  // A cancel answered with the file's details: show them at once (no reload),
  // ignoring any load still in flight.
  const showCancelled = (details: FileDetails) => {
    requestRef.current += 1;
    setLoaded({ fileId, file: details });
    setFailure(null);
  };

  // A refused cancel: bring the file up to date in place.
  const refreshAfterRefusal = () => {
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
  } else if (failure !== null && file === null) {
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
    content = (
      <>
        {failure !== null && <RefreshFailedNotice onRetry={retry} />}
        <FileDetailsContent
          file={file}
          role={role}
          onCancelled={showCancelled}
          onRefused={refreshAfterRefusal}
        />
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <BackToDashboard />
      {content}
    </div>
  );
}
