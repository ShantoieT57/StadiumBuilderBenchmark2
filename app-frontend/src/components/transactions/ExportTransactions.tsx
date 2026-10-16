'use client';

/**
 * The Approver's "Export" action on the Transactions screen (EX-01..EX-04).
 *
 * - Downloads the CSV of exactly the list's current filters and sort, every page
 *   (`query` carries no `page` / `pageSize`), through `exportTransactions`.
 * - The file is saved unchanged under the server's name (`Content-Disposition`);
 *   its contents are never read, shown or logged (NFR-3, NFR-4).
 * - While the request runs the button reads "Exporting…" and is disabled, so an
 *   export cannot be started twice; on success a self-closing "Export downloaded"
 *   message names the file (GN-05).
 * - Rendered for Approvers only by the list (hidden, never disabled, for Importers).
 */

import { DownloadIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/contexts/ToastContext';
import { exportTransactions } from '@/lib/api/endpoints';
import { isRedirectingToSignIn } from '@/lib/api/errors';
import { saveBlob } from '@/lib/download/saveBlob';
import type { ExportTransactionsQuery } from '@/types/api-generated';

export const EXPORT_LABEL = 'Export';
export const EXPORTING_LABEL = 'Exporting…';
export const EXPORT_DOWNLOADED_MESSAGE = 'Export downloaded';

export function ExportTransactions({
  query,
}: {
  /** The list's current filters and sort (no paging). */
  query: ExportTransactionsQuery;
}) {
  const { showToast } = useToast();
  const [exporting, setExporting] = useState(false);

  const runExport = (exportQuery: ExportTransactionsQuery) => {
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
        // Failure handling (nothing to export, problems + retry) goes here.
      },
    );
  };

  return (
    <div className="flex md:justify-end">
      <Button
        type="button"
        variant="outline"
        className="w-full md:w-auto"
        disabled={exporting}
        onClick={() => runExport(query)}
      >
        <DownloadIcon aria-hidden="true" />
        {exporting ? EXPORTING_LABEL : EXPORT_LABEL}
      </Button>
    </div>
  );
}
