/**
 * "Someone got there first" (R9, R14, BR6): the shared handling of a 409 from
 * approve or reject.
 *
 * The back-end answers 409 `{ message, transaction }` when the transaction is no
 * longer Imported; nothing was changed. The screen shows the back-end's message
 * verbatim plus the transaction's current status in words (and the rejection
 * reason when it was rejected) as a persistent problem, and brings the row up to
 * date from `transaction`. No retry is offered: the decision is final.
 *
 * Messages name only the status and reason, never account numbers or
 * descriptions, and nothing here is logged.
 */

import { bodyMessageOf, isAPIError, statusOf } from '@/lib/api/errors';
import { formatTransactionStatus } from '@/lib/format/transaction';
import type {
  TransactionDetails,
  TransactionListItem,
} from '@/types/api-generated';
import type { ToastOptions } from '@/types/toast';

/** Used when a 409 carries no message of its own. */
export const DECISION_CONFLICT_FALLBACK_MESSAGE =
  'This transaction has already been reviewed.';

export interface DecisionConflict {
  /** The back-end's own words, verbatim. */
  message: string;
  /** The transaction as it is now, when the 409 body carried it. */
  transaction: TransactionDetails | null;
}

function isTransactionDetails(value: unknown): value is TransactionDetails {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<TransactionDetails>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.reference === 'string' &&
    typeof candidate.status === 'string'
  );
}

/** The 409 "already decided" answer of approve / reject, or null for any other failure. */
export function decisionConflictOf(error: unknown): DecisionConflict | null {
  if (statusOf(error) !== 409 || !isAPIError(error)) return null;
  const body = error.body;
  const transaction =
    typeof body === 'object' && body !== null
      ? (body as { transaction?: unknown }).transaction
      : undefined;
  return {
    message: bodyMessageOf(error) ?? DECISION_CONFLICT_FALLBACK_MESSAGE,
    transaction: isTransactionDetails(transaction) ? transaction : null,
  };
}

/** "It is now <Status>." plus " Reason: <reason>" when it was rejected. */
export function currentStatusSentence(details: TransactionDetails): string {
  const status = `It is now ${formatTransactionStatus(details.status)}.`;
  const reason = details.rejectionReason?.trim();
  return details.status === 'Rejected' && reason
    ? `${status} Reason: ${reason}`
    : status;
}

/** The persistent problem message for a conflict. */
export function decisionConflictToast(
  conflict: DecisionConflict,
): ToastOptions {
  return {
    variant: 'error',
    title: conflict.message,
    message: conflict.transaction
      ? currentStatusSentence(conflict.transaction)
      : undefined,
  };
}

/** The list row for the details the back-end returned (decision or conflict). */
export function toTransactionListItem(
  details: TransactionDetails,
): TransactionListItem {
  return {
    id: details.id,
    reference: details.reference,
    transactionDate: details.transactionDate,
    accountNumber: details.accountNumber,
    description: details.description,
    amount: details.amount,
    currency: details.currency,
    transactionType: details.transactionType,
    status: details.status,
    file: details.file,
  };
}
