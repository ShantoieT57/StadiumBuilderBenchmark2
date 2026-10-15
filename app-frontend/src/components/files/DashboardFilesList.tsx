'use client';

/**
 * The Dashboard's file list with the per-row actions for the signed-in role.
 * A server page cannot hand a function (`rowActions`) to the client `FilesList`,
 * so this client wrapper decides the actions from the role it is given.
 *
 * Importer: a "Correct" shortcut (accessible name "Correct <file name>") on each
 * file waiting for corrections - Failed because of invalid rows and not
 * cancelled. Nothing for any other file, and nothing at all for an Approver
 * (hidden, never disabled).
 */

import Link from 'next/link';

import {
  FilesList,
  correctionsHref,
  type FileRowActions,
} from '@/components/files/FilesList';
import { Button } from '@/components/ui/button';
import type { FileListItem, UserRole } from '@/types/api-generated';

/** True when a listed file is waiting for an importer to correct its invalid rows. */
export function needsCorrecting(file: FileListItem): boolean {
  return (
    file.status === 'Failed' &&
    file.failureKind === 'InvalidRows' &&
    !file.isCancelled
  );
}

const importerRowActions: FileRowActions = (file) =>
  needsCorrecting(file) ? (
    <Button asChild variant="outline" size="sm">
      <Link
        href={correctionsHref(file.id)}
        aria-label={`Correct ${file.fileName}`}
      >
        Correct
      </Link>
    </Button>
  ) : null;

export function DashboardFilesList({ role }: { role: UserRole }) {
  return (
    <FilesList
      role={role}
      rowActions={role === 'Importer' ? importerRowActions : undefined}
    />
  );
}
