import { z } from 'zod';

/**
 * The Reject form's reason (R10, R11, BR4).
 *
 * Mirrors the back-end's rule: the reason is trimmed, then must hold 1 to 500
 * characters counted as JavaScript `.length` (UTF-16 code units, as the server
 * counts them). The field value itself is kept as typed; the trimmed reason is
 * what gets sent.
 */
export const MAX_REASON_LENGTH = 500;
export const REASON_REQUIRED_MESSAGE = 'Enter a reason for rejecting.';
export const REASON_TOO_LONG_MESSAGE = `The reason can be at most ${MAX_REASON_LENGTH} characters.`;

export const rejectReasonSchema = z.object({
  reason: z.string().superRefine((value, ctx) => {
    const length = value.trim().length;
    if (length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: REASON_REQUIRED_MESSAGE,
      });
    } else if (length > MAX_REASON_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: REASON_TOO_LONG_MESSAGE,
      });
    }
  }),
});

export type RejectReasonValues = z.infer<typeof rejectReasonSchema>;

/** The counter's words: "<N> characters left", or "<N> characters too many" when over. */
export function reasonCounterText(reason: string): string {
  const left = MAX_REASON_LENGTH - reason.trim().length;
  if (left >= 0)
    return `${left} ${left === 1 ? 'character' : 'characters'} left`;
  const over = -left;
  return `${over} ${over === 1 ? 'character' : 'characters'} too many`;
}
