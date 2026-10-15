/**
 * Project-wide mock factories for the correction entities - InvalidRow /
 * InvalidRowList (GET + PATCH /files/{id}/invalid-rows), RowCorrection (PATCH body
 * `rows`, POST recheck body `corrections`) and RecheckResult (POST /files/{id}/recheck)
 * - plus the seeded rows of the two files waiting for corrections, and the back-end's
 * row rules, so Vitest and the e2e mock back-end (e2e/fixtures/mock-backend.ts)
 * agree on what passes.
 *
 * Seeded rows (ALL rows of each file, valid ones too, since a re-check runs the rules
 * over every row). Row ids are UUIDs `3b5e1c70-0000-4000-8000-NN00000000RR`
 * (NN = file, RR = row number):
 *
 *   File 06 april-invalid-rows.csv (15 rows, 2 invalid):
 *     Row 4  APRIL-INVALID-ROWS-0004  date "2026/13/45 08:04", account ""
 *            -> [Invalid Transaction Date, Missing Account Number]
 *     Row 11 APRIL-INVALID-ROWS-0011  amount "-509.75"
 *            -> [Invalid Amount]
 *     Passes when: row 4 date "2026/04/04 08:04" + account "1001-2034-5567",
 *                  row 11 amount "509.75"  (`FIXING_CORRECTIONS[06]`)
 *     -> Completed, 15 loaded, 0 skipped, 0 ignored, 15 Imported.
 *
 *   File 11 Q1-Adjustments.csv (9 rows, 3 invalid; row 9 has an empty reference):
 *     Row 3  Q1-ADJUSTMENTS-0003  -> [Duplicate Reference In File]
 *     Row 5  Q1-ADJUSTMENTS-0005  type "X" -> [Invalid Transaction Type]
 *     Row 7  q1-adjustments-0003  -> [Duplicate Reference In File]  (same as row 3, ignoring case)
 *     Row 9  ""  (empty reference, amount "n/a") -> ignored, never invalid
 *     Passes when: row 5 type "C", row 7 reference "Q1-ADJUSTMENTS-0007"
 *                  (`FIXING_CORRECTIONS[11]`); changing row 3's OR row 7's reference
 *                  clears the duplicate on both.
 *     -> Completed, 8 loaded, 0 skipped, 1 ignored, 8 Imported.
 *
 * Imports are type-only and relative so the Playwright runtime can load this file
 * without `@/` alias plumbing.
 */
import type {
  FileDetails,
  InvalidRow,
  InvalidRowList,
  ProcessingStageEntry,
  RecheckResult,
  RowCorrection,
} from '../../types/api-generated';
import { DASHBOARD_FILE_IDS, seededFileDetails } from './files';

// ---------------------------------------------------------------------------
// Back-end wording
// ---------------------------------------------------------------------------

/** The reasons a row can fail, exactly as the back-end words them (in its order). */
export const INVALID_TRANSACTION_TYPE = 'Invalid Transaction Type';
export const INVALID_TRANSACTION_DATE = 'Invalid Transaction Date';
export const INVALID_AMOUNT = 'Invalid Amount';
export const MISSING_ACCOUNT_NUMBER = 'Missing Account Number';
export const DUPLICATE_REFERENCE_IN_FILE = 'Duplicate Reference In File';

/** 409 `message` of invalid-rows / PATCH / recheck for a file not waiting for corrections. */
export const NOT_WAITING_FOR_CORRECTIONS_MESSAGE =
  'This file is not waiting for corrections.';

/** 400 `message` when a correction names a row that is not one of the file's invalid rows. */
export const NOT_AN_INVALID_ROW_MESSAGE =
  "Only the file's invalid rows can be corrected.";

/** 400 `message` when one request corrects the same row twice. */
export const ROW_REPEATED_MESSAGE =
  'Each row can be corrected only once in a request.';

/** The failure reason of a file with `count` invalid rows ("File has 1 invalid row"). */
export function invalidRowsFailureReason(count: number): string {
  return count === 1
    ? 'File has 1 invalid row'
    : `File has ${count} invalid rows`;
}

/** The seven correctable columns, in file order (also the RowCorrection fields). */
export const ROW_FIELDS = [
  'reference',
  'transactionDate',
  'accountNumber',
  'description',
  'amount',
  'transactionType',
  'currency',
] as const;

export type RowField = (typeof ROW_FIELDS)[number];

/** The back-end's "missing value" message for `field` ("The TransactionDate field is required."). */
export function fieldRequiredMessage(field: string): string {
  return `The ${field.charAt(0).toUpperCase()}${field.slice(1)} field is required.`;
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/** The id of row `rowNumber` of the seeded file `fileId` (a UUID). */
export function seededRowId(fileId: string, rowNumber: number): string {
  const file = fileId.slice(-2);
  return `3b5e1c70-0000-4000-8000-${file}00000000${String(rowNumber).padStart(2, '0')}`;
}

/** Ids of the seeded INVALID rows, by file key and row number. */
export const INVALID_ROW_IDS = {
  invalidRows: {
    row4: seededRowId(DASHBOARD_FILE_IDS.invalidRows, 4),
    row11: seededRowId(DASHBOARD_FILE_IDS.invalidRows, 11),
  },
  mixedCaseInvalid: {
    row3: seededRowId(DASHBOARD_FILE_IDS.mixedCaseInvalid, 3),
    row5: seededRowId(DASHBOARD_FILE_IDS.mixedCaseInvalid, 5),
    row7: seededRowId(DASHBOARD_FILE_IDS.mixedCaseInvalid, 7),
  },
} as const;

/** Id of a VALID row of file 06 (row 1): correcting it is refused with NOT_AN_INVALID_ROW_MESSAGE. */
export const VALID_ROW_ID = seededRowId(DASHBOARD_FILE_IDS.invalidRows, 1);

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/**
 * Canonical default: row 4 of april-invalid-rows.csv (file 06), with a bad date and
 * a missing account number.
 */
export function createInvalidRow(
  overrides: Partial<InvalidRow> = {},
): InvalidRow {
  return {
    id: INVALID_ROW_IDS.invalidRows.row4,
    rowNumber: 4,
    reference: 'APRIL-INVALID-ROWS-0004',
    transactionDate: '2026/13/45 08:04',
    accountNumber: '',
    description: 'Mock row 4',
    amount: '249.00',
    transactionType: 'C',
    currency: 'ZAR',
    reasons: [INVALID_TRANSACTION_DATE, MISSING_ACCOUNT_NUMBER],
    ...overrides,
  };
}

/** An InvalidRowList of `rows` (default: file 06's two invalid rows); totalCount = rows.length. */
export function createInvalidRowList(rows?: InvalidRow[]): InvalidRowList {
  const list = rows ?? seededInvalidRows(DASHBOARD_FILE_IDS.invalidRows).rows;
  return { totalCount: list.length, rows: list.map(copyRow) };
}

/** The RowCorrection of a row (all seven values as they are), with `overrides` applied. */
export function toRowCorrection(
  row: Pick<InvalidRow, 'id' | RowField>,
  overrides: Partial<RowCorrection> = {},
): RowCorrection {
  return {
    id: row.id,
    reference: row.reference,
    transactionDate: row.transactionDate,
    accountNumber: row.accountNumber,
    description: row.description,
    amount: row.amount,
    transactionType: row.transactionType,
    currency: row.currency,
    ...overrides,
  };
}

/** Canonical default: the correction that fixes row 4 of file 06. */
export function createRowCorrection(
  overrides: Partial<RowCorrection> = {},
): RowCorrection {
  return {
    ...FIXING_CORRECTIONS[DASHBOARD_FILE_IDS.invalidRows][0],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Seeded rows
// ---------------------------------------------------------------------------

/** A row of a file kept for corrections: an InvalidRow whose `reasons` may be empty (valid). */
export type MockFileRow = InvalidRow;

function copyRow(row: InvalidRow): InvalidRow {
  return { ...row, reasons: [...row.reasons] };
}

/** A valid row `n` of a file, in the same pattern as `fileContentFor` (files.ts). */
function generatedRow(fileId: string, stem: string, n: number): MockFileRow {
  const day = String(1 + ((n - 1) % 28)).padStart(2, '0');
  return {
    id: seededRowId(fileId, n),
    rowNumber: n,
    reference: `${stem}-${String(n).padStart(4, '0')}`,
    transactionDate: `2026/04/${day} 08:${String(n % 60).padStart(2, '0')}`,
    accountNumber: '1001-2034-5567',
    description: `Mock row ${n}`,
    amount: (100 + n * 37.25).toFixed(2),
    transactionType: n % 3 === 0 ? 'D' : 'C',
    currency: 'ZAR',
    reasons: [],
  };
}

function rowsOf(
  fileId: string,
  stem: string,
  count: number,
  changes: Record<number, Partial<MockFileRow>>,
): MockFileRow[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return { ...generatedRow(fileId, stem, n), ...changes[n] };
  });
}

/**
 * EVERY row (valid and invalid, in file order, fresh copies) of a seeded file waiting
 * for corrections: file 06 (15 rows) and file 11 (9 rows). [] for any other file.
 */
export function seededFileRows(fileId: string): MockFileRow[] {
  const id = fileId.toLowerCase();
  if (id === DASHBOARD_FILE_IDS.invalidRows) {
    return rowsOf(id, 'APRIL-INVALID-ROWS', 15, {
      4: {
        transactionDate: '2026/13/45 08:04',
        accountNumber: '',
        reasons: [INVALID_TRANSACTION_DATE, MISSING_ACCOUNT_NUMBER],
      },
      11: { amount: '-509.75', reasons: [INVALID_AMOUNT] },
    });
  }
  if (id === DASHBOARD_FILE_IDS.mixedCaseInvalid) {
    return rowsOf(id, 'Q1-ADJUSTMENTS', 9, {
      3: { reasons: [DUPLICATE_REFERENCE_IN_FILE] },
      5: { transactionType: 'X', reasons: [INVALID_TRANSACTION_TYPE] },
      7: {
        reference: 'q1-adjustments-0003',
        reasons: [DUPLICATE_REFERENCE_IN_FILE],
      },
      9: { reference: '', amount: 'n/a', description: 'Total line' },
    });
  }
  return [];
}

/** The invalid rows of `rows` as GET invalid-rows lists them. */
export function invalidRowListOf(rows: MockFileRow[]): InvalidRowList {
  const invalid = rows.filter((r) => r.reasons.length > 0).map(copyRow);
  return { totalCount: invalid.length, rows: invalid };
}

/** GET /files/{id}/invalid-rows for a seeded file (06: 2 rows, 11: 3 rows; else empty). */
export function seededInvalidRows(fileId: string): InvalidRowList {
  return invalidRowListOf(seededFileRows(fileId));
}

/** The corrections (Check again body) that make each seeded file pass every rule. */
export const FIXING_CORRECTIONS: Record<string, RowCorrection[]> = {
  [DASHBOARD_FILE_IDS.invalidRows]: [
    toRowCorrection(seededFileRows(DASHBOARD_FILE_IDS.invalidRows)[3], {
      transactionDate: '2026/04/04 08:04',
      accountNumber: '1001-2034-5567',
    }),
    toRowCorrection(seededFileRows(DASHBOARD_FILE_IDS.invalidRows)[10], {
      amount: '509.75',
    }),
  ],
  [DASHBOARD_FILE_IDS.mixedCaseInvalid]: [
    toRowCorrection(seededFileRows(DASHBOARD_FILE_IDS.mixedCaseInvalid)[4], {
      transactionType: 'C',
    }),
    toRowCorrection(seededFileRows(DASHBOARD_FILE_IDS.mixedCaseInvalid)[6], {
      reference: 'Q1-ADJUSTMENTS-0007',
    }),
  ],
};

// ---------------------------------------------------------------------------
// Row rules (as the back-end's RowChecker)
// ---------------------------------------------------------------------------

const AMOUNT_PATTERN = /^[0-9]+(\.[0-9]{1,2})?$/;
const AMOUNT_LIMIT = 10_000_000_000_000_000;
/** yyyy/M/d H:mm, yyyy-M-d H:mm and yyyy-M-dTH:mm, each with optional :ss and :ss.FFFFFFF. */
const DATE_PATTERN =
  /^(\d{4})([/-])(\d{1,2})\2(\d{1,2})([ T])(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?$/;

/** The local ISO date-time (`yyyy-MM-ddTHH:mm:ss`) a row date reads as, or null. */
export function parseRowDate(value: string): string | null {
  const m = DATE_PATTERN.exec(value.trim());
  if (!m) return null;
  // "/" only with a space; "T" only with "-".
  if (m[2] === '/' && m[5] === 'T') return null;
  const [year, month, day, hour, minute, second] = [
    Number(m[1]),
    Number(m[3]),
    Number(m[4]),
    Number(m[6]),
    Number(m[7]),
    Number(m[8] ?? '0'),
  ];
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth || hour > 23 || minute > 59 || second > 59) return null;
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

/** The amount a row amount reads as (digits, up to 2 decimals, not negative), or null. */
export function parseRowAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!AMOUNT_PATTERN.test(trimmed)) return null;
  const amount = Number(trimmed);
  return amount < AMOUNT_LIMIT ? amount : null;
}

/** True when the row has a reference (an empty reference = ignored, never checked). */
export function hasReference(row: Pick<InvalidRow, 'reference'>): boolean {
  return row.reference.trim() !== '';
}

/**
 * Stage 5 over every row of a file: each row with a reference gets every rule it
 * breaks (type, date, amount, account, duplicate reference ignoring case); a row with
 * an empty reference is ignored (no reasons). Returns fresh rows.
 */
export function checkRows(rows: MockFileRow[]): MockFileRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!hasReference(row)) continue;
    const key = row.reference.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return rows.map((row) => {
    const reasons: string[] = [];
    if (hasReference(row)) {
      const type = row.transactionType.trim();
      if (type !== 'C' && type !== 'D') reasons.push(INVALID_TRANSACTION_TYPE);
      if (parseRowDate(row.transactionDate) === null)
        reasons.push(INVALID_TRANSACTION_DATE);
      if (parseRowAmount(row.amount) === null) reasons.push(INVALID_AMOUNT);
      if (row.accountNumber.trim() === '') reasons.push(MISSING_ACCOUNT_NUMBER);
      if ((counts.get(row.reference.trim().toLowerCase()) ?? 0) > 1)
        reasons.push(DUPLICATE_REFERENCE_IN_FILE);
    }
    return { ...row, reasons };
  });
}

/** `rows` with each correction's seven values saved; reasons kept from the last check. */
export function applyCorrections(
  rows: MockFileRow[],
  corrections: RowCorrection[],
): MockFileRow[] {
  const byId = new Map(corrections.map((c) => [c.id.toLowerCase(), c]));
  return rows.map((row) => {
    const c = byId.get(row.id.toLowerCase());
    if (!c) return copyRow(row);
    const values = Object.fromEntries(ROW_FIELDS.map((f) => [f, c[f]])) as Pick<
      InvalidRow,
      RowField
    >;
    return { ...row, ...values, reasons: [...row.reasons] };
  });
}

// ---------------------------------------------------------------------------
// Re-check outcome
// ---------------------------------------------------------------------------

/** The outcome of checking a file again (see `checkFileAgain`). */
export interface RecheckOutcome {
  result: RecheckResult;
  /** Every row after the check (with the new reasons). */
  rows: MockFileRow[];
  /** The rows loaded as transactions (Completed only; skipped / ignored rows excluded). */
  loadedRows: MockFileRow[];
}

function finishOpenWait(
  history: ProcessingStageEntry[],
  now: string,
): ProcessingStageEntry[] {
  return history.map((entry) =>
    entry.stage === 'WaitForCorrections' && entry.finishedAt === null
      ? { ...entry, finishedAt: now }
      : { ...entry },
  );
}

/**
 * POST /files/{id}/recheck over a waiting `file` and ALL its `rows`: saves the
 * `corrections`, re-runs the row rules over every row, and finishes the open
 * WaitForCorrections stage, adding ConvertTypes + CheckRows and then Load (Completed)
 * or a new open WaitForCorrections (still Failed). `existingReferences` (lower-cased)
 * are the references already loaded elsewhere: such rows are skipped, not loaded.
 */
export function checkFileAgain(
  file: FileDetails,
  rows: MockFileRow[],
  corrections: RowCorrection[],
  options: { now: string; existingReferences?: ReadonlySet<string> },
): RecheckOutcome {
  const { now } = options;
  const existing = options.existingReferences ?? new Set<string>();
  const checked = checkRows(applyCorrections(rows, corrections));
  const invalid = invalidRowListOf(checked);
  const history = [
    ...finishOpenWait(file.processingHistory, now),
    { stage: 'ConvertTypes' as const, startedAt: now, finishedAt: now },
    { stage: 'CheckRows' as const, startedAt: now, finishedAt: now },
  ];

  if (invalid.totalCount > 0) {
    const failed: FileDetails = {
      ...file,
      status: 'Failed',
      failureKind: 'InvalidRows',
      failureReason: invalidRowsFailureReason(invalid.totalCount),
      lastProcessedAt: now,
      processingHistory: [
        ...history,
        { stage: 'WaitForCorrections', startedAt: now, finishedAt: null },
      ],
    };
    return {
      result: { status: 'Failed', file: failed, invalidRows: invalid },
      rows: checked,
      loadedRows: [],
    };
  }

  const withReference = checked.filter(hasReference);
  const loadedRows = withReference.filter(
    (r) => !existing.has(r.reference.trim().toLowerCase()),
  );
  const completed: FileDetails = {
    ...file,
    status: 'Completed',
    failureKind: null,
    failureReason: null,
    lastProcessedAt: now,
    loadedCount: loadedRows.length,
    skippedExistingCount: withReference.length - loadedRows.length,
    ignoredEmptyReferenceCount: checked.length - withReference.length,
    transactions: { imported: loadedRows.length, approved: 0, rejected: 0 },
    isFullyReviewed: loadedRows.length === 0,
    areTransactionsAvailable: true,
    canDownload: !file.isCancelled,
    processingHistory: [
      ...history,
      { stage: 'Load', startedAt: now, finishedAt: now },
    ],
  };
  return {
    result: {
      status: 'Completed',
      file: completed,
      invalidRows: { totalCount: 0, rows: [] },
    },
    rows: checked,
    loadedRows,
  };
}

/**
 * Canonical default: file 06 checked again with `FIXING_CORRECTIONS` at
 * 2026-05-02T10:00:00+02:00 -> Completed, 15 loaded, invalidRows empty. Override any
 * part, e.g. a still-failing result:
 * `createRecheckResult({ status: 'Failed', invalidRows: createInvalidRowList([row]) })`
 * (the `file` is NOT re-derived from the overrides - override it too when it matters).
 */
export function createRecheckResult(
  overrides: Partial<RecheckResult> = {},
): RecheckResult {
  const id = DASHBOARD_FILE_IDS.invalidRows;
  const file = seededFileDetails(id);
  if (!file) throw new Error('seeded file 06 is missing');
  const { result } = checkFileAgain(
    file,
    seededFileRows(id),
    FIXING_CORRECTIONS[id],
    {
      now: '2026-05-02T10:00:00+02:00',
    },
  );
  return { ...result, ...overrides };
}
