/**
 * Display wording for files, shared by the Dashboard list and the file details
 * screen. Status is always shown in words (never by colour alone).
 */
import { formatLocalDateTime } from '@/lib/format/transaction';
import type { FileStatus, ProcessingStage } from '@/types/api-generated';

export const NOT_PROCESSED_YET = 'Not processed yet';
export const NOT_COUNTED_YET = 'Not counted yet';
export const CANCELLED_LABEL = 'Cancelled';

/** The file status in words. */
export const FILE_STATUS_LABELS: Record<FileStatus, string> = {
  Uploaded: 'Uploaded',
  Processing: 'Processing',
  Completed: 'Completed',
  Failed: 'Failed',
};

export function formatFileStatus(status: FileStatus): string {
  return FILE_STATUS_LABELS[status] ?? status;
}

/** A processing stage in plain words. */
export const PROCESSING_STAGE_LABELS: Record<ProcessingStage, string> = {
  Receive: 'Received',
  DuplicateCheck: 'Duplicate check',
  ReadRows: 'Read rows',
  ConvertTypes: 'Convert values',
  CheckRows: 'Check rows',
  WaitForCorrections: 'Waiting for corrections',
  Load: 'Load',
  Cancelled: 'Cancelled',
};

export function formatProcessingStage(stage: ProcessingStage): string {
  return PROCESSING_STAGE_LABELS[stage] ?? stage;
}

/** Last processed (offset ISO) in browser local time, or "Not processed yet". */
export function formatLastProcessed(value: string | null): string {
  return value === null ? NOT_PROCESSED_YET : formatLocalDateTime(value);
}

/** The number of rows, or "Not counted yet" before the file has been read. */
export function formatRowCount(value: number | null): string {
  return value === null ? NOT_COUNTED_YET : String(value);
}
