import { z } from 'zod';

/**
 * The transactions filter form's typed fields (R8, R9, BR9, BR10).
 *
 * Every field is optional. Range errors sit on the FIRST field of the range,
 * so the message appears on the field the person is most likely to change.
 * Amounts are non-negative decimals (up to 2 places); dates are the native
 * date input's `yyyy-MM-dd`.
 */
export const MIN_ABOVE_MAX_MESSAGE =
  'Minimum amount must not be more than the maximum amount.';
export const FROM_AFTER_TO_MESSAGE = 'From date must not be after the To date.';
export const AMOUNT_FORMAT_MESSAGE =
  'Enter an amount of 0 or more, such as 1000 or 1000.50.';
export const DATE_FORMAT_MESSAGE = 'Enter a valid date.';

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const amountField = z
  .string()
  .trim()
  .refine((value) => value === '' || AMOUNT_PATTERN.test(value), {
    message: AMOUNT_FORMAT_MESSAGE,
  });

const dateField = z
  .string()
  .trim()
  .refine((value) => value === '' || DATE_PATTERN.test(value), {
    message: DATE_FORMAT_MESSAGE,
  });

export const transactionFiltersSchema = z
  .object({
    dateFrom: dateField,
    dateTo: dateField,
    minAmount: amountField,
    maxAmount: amountField,
    search: z.string(),
  })
  .superRefine((values, ctx) => {
    if (
      AMOUNT_PATTERN.test(values.minAmount) &&
      AMOUNT_PATTERN.test(values.maxAmount) &&
      Number(values.minAmount) > Number(values.maxAmount)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minAmount'],
        message: MIN_ABOVE_MAX_MESSAGE,
      });
    }
    if (
      DATE_PATTERN.test(values.dateFrom) &&
      DATE_PATTERN.test(values.dateTo) &&
      values.dateFrom > values.dateTo
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateFrom'],
        message: FROM_AFTER_TO_MESSAGE,
      });
    }
  });

export type TransactionFilterValues = z.infer<typeof transactionFiltersSchema>;
