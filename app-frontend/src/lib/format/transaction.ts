/**
 * Display formatting for transactions, shared by the list, the details screen
 * and later lists (BR5 / BR7).
 *
 * - Dates are shown exactly as the API sends them (local time, no offset):
 *   no `Date` parsing, so no timezone conversion can happen.
 * - Amounts always show 2 decimals with en-US grouping, then the currency.
 * - Status is always shown in words (never by colour alone).
 */
import type { TransactionStatus, TransactionType } from '@/types/api-generated';

const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

/** `2026-04-15T23:30:00` -> `2026-04-15 23:30`, with no timezone conversion. */
export function formatTransactionDate(value: string): string {
  const match = LOCAL_DATE_TIME.exec(value);
  return match ? `${match[1]} ${match[2]}` : value;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * An ISO time WITH an offset (audit times such as `lastChangedAt`) in the
 * browser's local time: `2026-05-03T10:30:00+02:00` -> `2026-05-03 10:30` in
 * Johannesburg. Same layout as `formatTransactionDate`.
 */
export function formatLocalDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * Like `formatLocalDateTime`, to the second: `2026-05-03T10:30:15+02:00` ->
 * `2026-05-03 10:30:15` in Johannesburg (processing stages often share a minute).
 */
export function formatLocalDateTimeWithSeconds(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${formatLocalDateTime(value)}:${pad2(date.getSeconds())}`;
}

const AMOUNT_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `15750, 'ZAR'` -> `15,750.00 ZAR`. */
export function formatAmount(amount: number, currency: string): string {
  return `${AMOUNT_FORMAT.format(amount)} ${currency}`;
}

/** The status in words (FS-03). */
export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  Imported: 'Imported',
  Approved: 'Approved',
  Rejected: 'Rejected',
};

export function formatTransactionStatus(status: TransactionStatus): string {
  return TRANSACTION_STATUS_LABELS[status] ?? status;
}

/** Credit or Debit in words. */
export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  Credit: 'Credit',
  Debit: 'Debit',
};

export function formatTransactionType(type: TransactionType): string {
  return TRANSACTION_TYPE_LABELS[type] ?? type;
}
