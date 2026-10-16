'use client';

/**
 * The Approver's "Export" action on the Transactions screen (EX-01..EX-04,
 * R6, BR5, NFR-2, GN-01, GN-05).
 *
 * - Downloads the CSV of exactly the list's current filters and sort, every page
 *   (`query` carries no `page` / `pageSize`), through `exportTransactions`.
 * - The file is saved unchanged under the server's name (`Content-Disposition`);
 *   its contents are never read, shown or logged (NFR-3, NFR-4).
 * - While the request runs the button reads "Exporting…" and is disabled, so an
 *   export cannot be started twice; on success a self-closing "Export downloaded"
 *   message names the file (GN-05).
 * - Unavailable (`aria-disabled`, still focusable, selecting it sends nothing)
 *   before the list has loaded, when the loaded list matches nothing (with the
 *   `nothingToExport` note beside it, linked by `aria-describedby`), and after a
 *   409 until the filters change.
 * - Problems show inline beside the button (`role=alert`), never as a toast: a
 *   409 shows the server's message (and `onNothingToExport` lets the list bring
 *   its totals up to date); 403 the server's message; 400 a fixed sentence plus
 *   the server's `errors`; anything else (network, 5xx) "The export could not be
 *   downloaded." with "Try again", which repeats the same query. A problem stays
 *   until a new export starts or the filters (`filtersKey`) change.
 * - 401: the central client handler is already leaving for sign-in; nothing shows.
 * - Rendered for Approvers only by the list (hidden, never disabled, for Importers).
 */

import { DownloadIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useToast } from '@/contexts/ToastContext';
import { exportTransactions } from '@/lib/api/endpoints';
import {
  bodyMessageOf,
  isAPIError,
  isNetworkError,
  isRedirectingToSignIn,
  statusOf,
} from '@/lib/api/errors';
import { saveBlob } from '@/lib/download/saveBlob';
import type { ExportTransactionsQuery } from '@/types/api-generated';

export const EXPORT_LABEL = 'Export';
export const EXPORTING_LABEL = 'Exporting…';
export const EXPORT_DOWNLOADED_MESSAGE = 'Export downloaded';
export const EXPORT_FAILED_MESSAGE = 'The export could not be downloaded.';
export const EXPORT_INVALID_FILTERS_MESSAGE =
  'The current filters could not be used for the export.';
export const EXPORT_TRY_AGAIN_LABEL = 'Try again';
/** Nothing to export with filters set (the back-end's 409 wording). */
export const NO_MATCHES_TO_EXPORT_MESSAGE =
  'No transactions match the current filters, so there is nothing to export.';
/** Nothing to export with no filters (the back-end's 409 wording). */
export const NO_TRANSACTIONS_TO_EXPORT_MESSAGE =
  'There are no transactions yet, so there is nothing to export.';

/** An export problem shown beside the button. */
interface ExportProblem {
  message: string;
  /** 400: the server's validation messages. */
  details: string[];
  /** The query to repeat on "Try again" (network / server failures only). */
  retryQuery: ExportTransactionsQuery | null;
  /** 409: nothing matches any more; Export stays unavailable until the filters change. */
  stale: boolean;
}

function problemOf(
  error: unknown,
  query: ExportTransactionsQuery,
): ExportProblem {
  const status = statusOf(error);
  const serverMessage =
    bodyMessageOf(error) ??
    (isAPIError(error) && error.message.trim() !== ''
      ? error.message
      : undefined);
  if (!isNetworkError(error) && status === 409 && serverMessage) {
    return {
      message: serverMessage,
      details: [],
      retryQuery: null,
      stale: true,
    };
  }
  if (!isNetworkError(error) && status === 403 && serverMessage) {
    return {
      message: serverMessage,
      details: [],
      retryQuery: null,
      stale: false,
    };
  }
  if (!isNetworkError(error) && status === 400) {
    const details =
      isAPIError(error) && error.errors
        ? Object.values(error.errors).flat()
        : [];
    return {
      message: EXPORT_INVALID_FILTERS_MESSAGE,
      details,
      retryQuery: null,
      stale: false,
    };
  }
  return {
    message: EXPORT_FAILED_MESSAGE,
    details: [],
    retryQuery: query,
    stale: false,
  };
}

export function ExportTransactions({
  query,
  available,
  nothingToExport,
  filtersKey,
  onNothingToExport,
}: {
  /** The list's current filters and sort (no paging). */
  query: ExportTransactionsQuery;
  /** False until the list has loaded, and while it matches nothing. */
  available: boolean;
  /** Why there is nothing to export (the loaded list matched nothing), else null. */
  nothingToExport: string | null;
  /** Identifies the current filters (not the sort); a change clears any problem. */
  filtersKey: string;
  /** Called after a 409: the list should bring its totals up to date. */
  onNothingToExport?: () => void;
}) {
  const { showToast } = useToast();
  const messageId = useId();
  const [exporting, setExporting] = useState(false);
  const [problem, setProblem] = useState<ExportProblem | null>(null);
  const [problemFiltersKey, setProblemFiltersKey] = useState(filtersKey);

  // A change of filters clears the problem (a sort-only change does not).
  if (problemFiltersKey !== filtersKey) {
    setProblemFiltersKey(filtersKey);
    setProblem(null);
  }

  const unavailable = !available || problem?.stale === true;

  const runExport = (exportQuery: ExportTransactionsQuery) => {
    setProblem(null);
    setExporting(true);
    exportTransactions(exportQuery).then(
      ({ blob, fileName }) => {
        setExporting(false);
        saveBlob(blob, fileName);
        showToast({
          variant: 'success',
          title: EXPORT_DOWNLOADED_MESSAGE,
          message: fileName,
        });
      },
      (error: unknown) => {
        setExporting(false);
        // The page is leaving for sign-in: show nothing.
        if (isRedirectingToSignIn(error)) return;
        const next = problemOf(error, exportQuery);
        setProblem(next);
        if (next.stale) onNothingToExport?.();
      },
    );
  };

  let message: ReactNode = null;
  if (problem !== null) {
    message = (
      <Alert
        id={messageId}
        variant="destructive"
        className="min-w-0 break-words md:w-auto md:max-w-xl"
      >
        <AlertDescription>
          <p>{problem.message}</p>
          {problem.details.length > 0 && (
            <ul className="list-disc pl-5">
              {problem.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
          {problem.retryQuery !== null && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              disabled={exporting}
              onClick={() => {
                if (problem.retryQuery !== null) runExport(problem.retryQuery);
              }}
            >
              {EXPORT_TRY_AGAIN_LABEL}
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  } else if (nothingToExport !== null) {
    message = (
      <p
        id={messageId}
        className="text-muted-foreground min-w-0 text-sm break-words md:max-w-md"
      >
        {nothingToExport}
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 md:flex-row-reverse md:items-center md:justify-start">
      <Button
        type="button"
        variant="outline"
        className="w-full shrink-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 md:w-auto"
        disabled={exporting}
        aria-disabled={unavailable ? true : undefined}
        aria-describedby={message !== null ? messageId : undefined}
        onClick={() => {
          if (unavailable) return;
          runExport(query);
        }}
      >
        <DownloadIcon aria-hidden="true" />
        {exporting ? EXPORTING_LABEL : EXPORT_LABEL}
      </Button>
      {message}
    </div>
  );
}
