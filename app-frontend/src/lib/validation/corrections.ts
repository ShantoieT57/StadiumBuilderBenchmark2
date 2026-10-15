import { z } from 'zod';

/**
 * The correction form (BR7): one entry per invalid row, the seven values as text.
 * The rules mirror the back-end's row rules and use its reason wording; the
 * back-end stays authoritative (its answer is shown under the field too).
 */

export const INVALID_TRANSACTION_TYPE_MESSAGE = 'Invalid Transaction Type';
export const INVALID_TRANSACTION_DATE_MESSAGE = 'Invalid Transaction Date';
export const INVALID_AMOUNT_MESSAGE = 'Invalid Amount';
export const MISSING_ACCOUNT_NUMBER_MESSAGE = 'Missing Account Number';
export const DUPLICATE_REFERENCE_MESSAGE = 'Duplicate Reference In File';

/** The seven correctable values, in file order (also the RowCorrection fields). */
export const CORRECTION_FIELDS = [
  'reference',
  'transactionDate',
  'accountNumber',
  'description',
  'amount',
  'transactionType',
  'currency',
] as const;

export type CorrectionField = (typeof CORRECTION_FIELDS)[number];

const AMOUNT_PATTERN = /^[0-9]+(\.[0-9]{1,2})?$/;
/** yyyy/M/d H:mm, yyyy-M-d H:mm and yyyy-M-dTH:mm, each with optional :ss and :ss.FFFFFFF. */
const DATE_PATTERN =
  /^(\d{4})([/-])(\d{1,2})\2(\d{1,2})([ T])(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?$/;

/** True when `value` reads as a real date and time in one of the file's layouts. */
export function isRowDate(value: string): boolean {
  const m = DATE_PATTERN.exec(value.trim());
  if (!m) return false;
  // "/" only with a space; "T" only with "-".
  if (m[2] === '/' && m[5] === 'T') return false;
  const year = Number(m[1]);
  const month = Number(m[3]);
  const day = Number(m[4]);
  const hour = Number(m[6]);
  const minute = Number(m[7]);
  const second = Number(m[8] ?? '0');
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth && hour <= 23 && minute <= 59 && second <= 59;
}

/** True when `value` is a number, not negative, with at most two decimals. */
export function isRowAmount(value: string): boolean {
  return AMOUNT_PATTERN.test(value.trim());
}

export const correctionRowSchema = z.object({
  id: z.string(),
  reference: z.string(),
  transactionDate: z
    .string()
    .refine(isRowDate, { message: INVALID_TRANSACTION_DATE_MESSAGE }),
  accountNumber: z.string().refine((value) => value.trim() !== '', {
    message: MISSING_ACCOUNT_NUMBER_MESSAGE,
  }),
  description: z.string(),
  amount: z.string().refine(isRowAmount, { message: INVALID_AMOUNT_MESSAGE }),
  transactionType: z
    .string()
    .refine((value) => ['C', 'D'].includes(value.trim()), {
      message: INVALID_TRANSACTION_TYPE_MESSAGE,
    }),
  currency: z.string(),
});

export const correctionsSchema = z
  .object({ rows: z.array(correctionRowSchema) })
  .superRefine(({ rows }, ctx) => {
    // A reference repeated among the listed rows, ignoring case (empty ones excepted).
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = row.reference.trim().toLowerCase();
      if (key !== '') counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    rows.forEach((row, index) => {
      const key = row.reference.trim().toLowerCase();
      if (key !== '' && (counts.get(key) ?? 0) > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rows', index, 'reference'],
          message: DUPLICATE_REFERENCE_MESSAGE,
        });
      }
    });
  });

export type CorrectionRowValues = z.infer<typeof correctionRowSchema>;
export type CorrectionsValues = z.infer<typeof correctionsSchema>;
