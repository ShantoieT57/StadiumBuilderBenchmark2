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

/** The back-end's 409 message for a transaction that is already Approved. */
export const ALREADY_APPROVED_MESSAGE =
  'This transaction has already been approved.';

/** The back-end's 409 message for a transaction that is already Rejected. */
export const ALREADY_REJECTED_MESSAGE =
  'This transaction has already been rejected.';

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

/** What the status sentence needs: the status, and the reason when known. */
type CurrentStatus = Pick<TransactionDetails, 'status'> & {
  rejectionReason?: string | null;
};

/** "It is now <Status>." plus " Reason: <reason>" when it was rejected. */
export function currentStatusSentence(details: CurrentStatus): string {
  const status = `It is now ${formatTransactionStatus(details.status)}.`;
  const reason = details.rejectionReason?.trim();
  return details.status === 'Rejected' && reason
    ? `${status} Reason: ${reason}`
    : status;
}

/** What an open Approve / Reject reports to the list: closed, open, or sending. */
export type DecisionActivity = 'closed' | 'open' | 'sending';

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

/**
 * The same conflict, seen first by a live refresh: the row behind an open
 * Approve / Reject is no longer Imported, so the decision is never sent (BR2).
 * Built from the transaction's details (or, failing those, its list row),
 * worded as the back-end words the 409; the reason is included when known.
 * Null while still Imported.
 */
export function decidedElsewhereToast(
  item: CurrentStatus,
): ToastOptions | null {
  if (item.status === 'Imported') return null;
  return {
    variant: 'error',
    title:
      item.status === 'Approved'
        ? ALREADY_APPROVED_MESSAGE
        : ALREADY_REJECTED_MESSAGE,
    message: currentStatusSentence(item),
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
