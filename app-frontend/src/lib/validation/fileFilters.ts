import { z } from 'zod';

import { isCalendarDay } from '@/lib/files/listQuery';

/**
 * The Dashboard file filter form's typed fields (R5, NFR-4).
 *
 * Every field is optional. A reversed process-date range puts its message on
 * Processed from. Dates are the native date input's `yyyy-MM-dd` and must be
 * real calendar days.
 */
export const PROCESSED_FROM_AFTER_TO_MESSAGE =
  'Processed from must not be after the Processed to date.';
export const PROCESSED_DATE_FORMAT_MESSAGE = 'Enter a valid date.';

const dateField = z
  .string()
  .trim()
  .refine((value) => value === '' || isCalendarDay(value), {
    message: PROCESSED_DATE_FORMAT_MESSAGE,
  });

export const fileFiltersSchema = z
  .object({
    fileName: z.string(),
    processedFrom: dateField,
    processedTo: dateField,
  })
  .superRefine((values, ctx) => {
    if (
      isCalendarDay(values.processedFrom) &&
      isCalendarDay(values.processedTo) &&
      values.processedFrom > values.processedTo
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['processedFrom'],
        message: PROCESSED_FROM_AFTER_TO_MESSAGE,
      });
    }
  });

export type FileFilterValues = z.infer<typeof fileFiltersSchema>;
