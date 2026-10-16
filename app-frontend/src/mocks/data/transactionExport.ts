/**
 * Project-wide mock source for the transaction export (epic transaction-export,
 * GET /transactions/export). Shared by Vitest and the e2e mock back-end
 * (e2e/fixtures/mock-backend.ts), so both layers produce byte-identical files.
 *
 * Mirrors the back-end (app-backend/.../TransactionApi/TransactionCsv.cs,
 * ExportFileName.cs, Controller.ExportTransactions) and TransactionApi.yaml:
 *   - CSV: UTF-8 with a byte-order mark (U+FEFF -> EF BB BF), a header record, every
 *     record (the last too) ending CR LF, RFC 4180 quoting (a field holding `,` `"`
 *     CR or LF is quoted, inner `"` doubled), Amount `F2` (`15750.00`, no separators,
 *     no sign), Transaction Date `yyyy-MM-dd HH:mm:ss` + fraction only when there is
 *     one, Last Changed On `yyyy-MM-dd HH:mm:ss` in the export time zone
 *     (Africa/Johannesburg, SAST = UTC+02:00, no daylight saving), and a leading `'`
 *     on a text cell starting with `=` `+` `-` `@` TAB or CR (formula injection).
 *   - File name: `transactions_[<filters>_]<export date>.csv`, see `exportFileName`.
 *   - Content-Type `text/csv; charset=utf-8`; Content-Disposition
 *     `attachment; filename=<name>; filename*=UTF-8''<name>` (`contentDispositionFor`).
 *   - 409 `{ message }` when nothing matches: NO_MATCHES_TO_EXPORT_MESSAGE with any
 *     filter, NO_TRANSACTIONS_TO_EXPORT_MESSAGE with none.
 *
 * Imports are type-only / relative so the Playwright runtime can load this file
 * without `@/` alias plumbing.
 */
import type {
  ErrorResponse,
  TransactionDetails,
} from '../../types/api-generated';
import { contentDispositionFor } from './files';
import { seedTransactionDetails } from './transactions';

// ---------------------------------------------------------------------------
// Response metadata and messages
// ---------------------------------------------------------------------------

/** The export's Content-Type, exactly as the back-end sends it. */
export const EXPORT_CONTENT_TYPE = 'text/csv; charset=utf-8';

/** The UTF-8 byte-order mark as a string character (encodes to EF BB BF). */
export const EXPORT_BOM = '﻿';

/** The three bytes the file starts with. */
export const EXPORT_BOM_BYTES: readonly number[] = [0xef, 0xbb, 0xbf];

/** The record terminator, after every record including the last. */
export const EXPORT_LINE_ENDING = '\r\n';

/** 409 message when filters are active and nothing matches them. */
export const NO_MATCHES_TO_EXPORT_MESSAGE =
  'No transactions match the current filters, so there is nothing to export.';

/** 409 message when no filters are active and there are no transactions at all. */
export const NO_TRANSACTIONS_TO_EXPORT_MESSAGE =
  'There are no transactions yet, so there is nothing to export.';

/** The 409 body of an export that matches nothing. */
export function nothingToExportBody(hasActiveFilters: boolean): ErrorResponse {
  return {
    message: hasActiveFilters
      ? NO_MATCHES_TO_EXPORT_MESSAGE
      : NO_TRANSACTIONS_TO_EXPORT_MESSAGE,
  };
}

/** The file name the front-end saves under when Content-Disposition is missing (story 1). */
export const FALLBACK_EXPORT_FILE_NAME = 'transactions.csv';

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** The export's columns, in order (the list's columns plus the review details). */
export const EXPORT_COLUMNS: readonly string[] = [
  'Reference',
  'Transaction Date',
  'Account Number',
  'Description',
  'Amount',
  'Currency',
  'Type',
  'Status',
  'File',
  'Rejection Reason',
  'Last Changed By',
  'Last Changed On',
];

/** The header line, without its CR LF. */
export const EXPORT_HEADER_LINE = EXPORT_COLUMNS.join(',');

/** Offset of the export time zone (Africa/Johannesburg, SAST, no daylight saving), in hours. */
export const EXPORT_TIME_ZONE_OFFSET_HOURS = 2;

const FORMULA_STARTS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** A text cell, with a leading apostrophe when it starts like a formula. */
function textCell(value: string): string {
  return value.length > 0 && FORMULA_STARTS.has(value[0]) ? `'${value}` : value;
}

/** RFC 4180: quote a field holding `,` `"` CR or LF, doubling inner quotes. */
function quoteField(field: string): string {
  return /[,"\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

function csvRecord(fields: readonly string[]): string {
  return fields.map(quoteField).join(',') + EXPORT_LINE_ENDING;
}

const LOCAL_DATE_TIME_PARTS =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/;

/**
 * Transaction Date as exported: `yyyy-MM-dd HH:mm:ss`, plus `.f..` (at most 7
 * digits, trailing zeros removed) only when there is a fraction of a second.
 */
export function exportTransactionDate(transactionDate: string): string {
  const match = LOCAL_DATE_TIME_PARTS.exec(transactionDate);
  if (!match) return transactionDate;
  const [, date, hh, mm, ss = '00', fraction = ''] = match;
  const trimmed = fraction.slice(0, 7).replace(/0+$/, '');
  return `${date} ${hh}:${mm}:${ss}${trimmed ? `.${trimmed}` : ''}`;
}

/** Last Changed On as exported: to the second, `yyyy-MM-dd HH:mm:ss`, in SAST. */
export function exportLastChangedOn(lastChangedAt: string): string {
  const ms = Date.parse(lastChangedAt);
  if (Number.isNaN(ms)) return lastChangedAt;
  const local = new Date(ms + EXPORT_TIME_ZONE_OFFSET_HOURS * 3_600_000);
  return local.toISOString().slice(0, 19).replace('T', ' ');
}

/** Amount as exported: two decimals, a dot, no separators, no sign. */
export function exportAmount(amount: number): string {
  return Math.abs(amount).toFixed(2);
}

/** One transaction's 12 fields, before quoting. */
export function exportFieldsOf(t: TransactionDetails): string[] {
  return [
    textCell(t.reference),
    exportTransactionDate(t.transactionDate),
    textCell(t.accountNumber),
    textCell(t.description),
    exportAmount(t.amount),
    textCell(t.currency),
    t.transactionType,
    t.status,
    textCell(t.file.fileName),
    textCell(t.rejectionReason ?? ''),
    textCell(t.lastChangedBy),
    exportLastChangedOn(t.lastChangedAt),
  ];
}

/** One transaction's record (quoted, with its CR LF). */
export function exportRecordOf(t: TransactionDetails): string {
  return csvRecord(exportFieldsOf(t));
}

/**
 * The whole export of `transactions` (already filtered and in order), exactly as
 * the back-end sends it: BOM + header record + one record per transaction.
 * Encode as UTF-8 (e.g. `Buffer.from(csv, 'utf8')`, `new Blob([csv])`) for the bytes.
 */
export function exportCsvOf(
  transactions: readonly TransactionDetails[],
): string {
  return (
    EXPORT_BOM +
    csvRecord(EXPORT_COLUMNS) +
    transactions.map(exportRecordOf).join('')
  );
}

// ---------------------------------------------------------------------------
// File name (EX-04)
// ---------------------------------------------------------------------------

/**
 * The filter part of an export request, as sent in the query (strings as sent,
 * amounts as numbers or strings). Sort and paging never affect the name. A typed
 * `ExportTransactionsQuery` / `TransactionFilterQuery` fits it as it is.
 */
export type ExportNameFilter = {
  status?: string | null;
  fileId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  minAmount?: number | string | null;
  maxAmount?: number | string | null;
  search?: string | null;
};

const present = (value: number | string | null | undefined): boolean =>
  value !== undefined && value !== null && String(value) !== '';

/**
 * True when any filter is active (the back-end's `!filter.IsEmpty`): any value
 * given, the search counted only when it is not blank once trimmed.
 */
export function hasActiveExportFilter(filter: ExportNameFilter): boolean {
  return (
    present(filter.status) ||
    present(filter.fileId) ||
    present(filter.dateFrom) ||
    present(filter.dateTo) ||
    present(filter.minAmount) ||
    present(filter.maxAmount) ||
    (filter.search ?? '').trim() !== ''
  );
}

/** Today's date (`yyyy-MM-dd`) in the export time zone (SAST), for the file name. */
export function exportDateOf(now: Date = new Date()): string {
  return new Date(now.getTime() + EXPORT_TIME_ZONE_OFFSET_HOURS * 3_600_000)
    .toISOString()
    .slice(0, 10);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

interface LocalTime {
  date: string;
  hh: string;
  mm: string;
  ss: string;
  /** Fraction of a second, in microseconds (the back-end keeps 6 digits). */
  micros: number;
}

function localTimeOf(value: string): LocalTime | null {
  const match = LOCAL_DATE_TIME_PARTS.exec(value);
  if (!match) return null;
  const [, date, hh, mm, ss = '00', fraction = ''] = match;
  const micros = Number(fraction.slice(0, 6).padEnd(6, '0'));
  return { date, hh, mm, ss, micros };
}

/** `yyyy-MM-ddTHHmm`, with `ss` added when the seconds are not zero. */
function nameTime(t: LocalTime): string {
  return `${t.date}T${t.hh}${t.mm}${t.ss === '00' ? '' : t.ss}`;
}

/** The start of a date range as named: the date alone when it is the start of a day. */
function nameStart(value: string): string {
  if (DATE_ONLY.test(value)) return value;
  const t = localTimeOf(value);
  if (!t) return value;
  const midnight =
    t.hh === '00' && t.mm === '00' && t.ss === '00' && t.micros === 0;
  return midnight ? t.date : nameTime(t);
}

/** The end of a date range as named: the date alone when it is the last microsecond of a day. */
function nameEnd(value: string): string {
  if (DATE_ONLY.test(value)) return value;
  const t = localTimeOf(value);
  if (!t) return value;
  const endOfDay =
    t.hh === '23' && t.mm === '59' && t.ss === '59' && t.micros === 999_999;
  return endOfDay ? t.date : nameTime(t);
}

/** An amount as named: a dot and no trailing zeros (`100`, `200.5`). */
function nameAmount(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(value);
  const plain = String(n);
  if (!/e/i.test(plain)) return plain;
  return n.toFixed(20).replace(/\.?0+$/, '');
}

const MAX_TEXT_LENGTH = 40;

/**
 * Text made safe for every file system: each run of characters other than letters,
 * marks, decimal digits, `-` and `.` becomes one `-` (characters outside the BMP
 * count as unsafe, as in .NET), `-` and `.` are trimmed from both ends, and at most
 * 40 characters are kept (then trimmed of `-` / `.` at the end again).
 */
export function safeExportText(text: string): string {
  const safe = text
    .replace(/(?:[^\p{L}\p{M}\p{Nd}.-]|[\u{10000}-\u{10FFFF}])+/gu, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return safe.length > MAX_TEXT_LENGTH
    ? safe.slice(0, MAX_TEXT_LENGTH).replace(/[-.]+$/, '')
    : safe;
}

function labelled(label: string, text: string): string {
  const safe = safeExportText(text);
  return safe.length > 0 ? `${label}-${safe}` : label;
}

function range(
  from: string | null,
  to: string | null,
  bothEndsPrefix: string,
): string | null {
  if (from !== null && to !== null) return `${bothEndsPrefix}${from}-to-${to}`;
  if (from !== null) return `from-${from}`;
  if (to !== null) return `to-${to}`;
  return null;
}

/**
 * The export's file name, exactly as the back-end builds it:
 * `transactions_[<filters>_]<exportDate>.csv`, one part per active filter in the
 * order status, `file-<name without .csv>`, dates (`from-a-to-b` | `from-a` | `to-b`),
 * amounts (`amount-a-to-b` | `amount-from-a` | `amount-to-b`), `search-<text>`.
 *
 * `fileName` is the name of the filtered file (the back-end takes it from a matching
 * transaction); needed only when `filter.fileId` is set.
 */
export function exportFileName(
  filter: ExportNameFilter,
  options: { exportDate: string; fileName?: string },
): string {
  const parts = ['transactions'];
  if (present(filter.status)) parts.push(String(filter.status));
  if (present(filter.fileId)) {
    parts.push(
      labelled('file', (options.fileName ?? '').replace(/\.csv$/i, '')),
    );
  }
  const dates = range(
    present(filter.dateFrom) ? nameStart(String(filter.dateFrom)) : null,
    present(filter.dateTo) ? nameEnd(String(filter.dateTo)) : null,
    'from-',
  );
  if (dates) parts.push(dates);
  const amounts = range(
    present(filter.minAmount)
      ? nameAmount(filter.minAmount as number | string)
      : null,
    present(filter.maxAmount)
      ? nameAmount(filter.maxAmount as number | string)
      : null,
    '',
  );
  if (amounts) parts.push(`amount-${amounts}`);
  const search = (filter.search ?? '').trim();
  if (search !== '') parts.push(labelled('search', search));
  parts.push(options.exportDate);
  return `${parts.join('_')}.csv`;
}

/** The filter part of an export query string (or URLSearchParams). */
export function exportNameFilterOf(
  query: URLSearchParams | string,
): ExportNameFilter {
  const params = typeof query === 'string' ? new URLSearchParams(query) : query;
  return {
    status: params.get('status'),
    fileId: params.get('fileId'),
    dateFrom: params.get('dateFrom'),
    dateTo: params.get('dateTo'),
    minAmount: params.get('minAmount'),
    maxAmount: params.get('maxAmount'),
    search: params.get('search'),
  };
}

/** The 200 response headers of an export saved as `fileName`. */
export function exportResponseHeaders(
  fileName: string,
): Record<string, string> {
  return {
    'content-type': EXPORT_CONTENT_TYPE,
    'content-disposition': contentDispositionFor(fileName),
  };
}

// ---------------------------------------------------------------------------
// Entity factory (Vitest)
// ---------------------------------------------------------------------------

/** A downloaded export as the front-end's endpoint function returns it (story 1). */
export interface TransactionExport {
  /** The file name taken from Content-Disposition. */
  fileName: string;
  /** The file, byte-for-byte as the server sent it (BOM included). */
  blob: Blob;
}

/**
 * Canonical default: the seeded Imported transactions (15, date descending) saved
 * as `transactions_Imported_2026-04-15.csv`. Pass `transactions` to export other
 * rows, or `fileName` / `blob` to override either part.
 */
export function createTransactionExport(
  overrides: Partial<TransactionExport> & {
    transactions?: readonly TransactionDetails[];
  } = {},
): TransactionExport {
  const { transactions, ...rest } = overrides;
  const rows =
    transactions ??
    seedTransactionDetails()
      .filter((t) => t.status === 'Imported')
      .sort((a, b) => (a.transactionDate < b.transactionDate ? 1 : -1));
  return {
    fileName: exportFileName(
      { status: 'Imported' },
      { exportDate: '2026-04-15' },
    ),
    blob: new Blob([exportCsvOf(rows)], { type: EXPORT_CONTENT_TYPE }),
    ...rest,
  };
}
