'use client';

/**
 * The Approver's decisions on one transaction row (R1, BR1): Approve and Reject,
 * as text buttons whose aria-label adds the reference ("Approve <reference>",
 * "Reject <reference>"). Rendered by the list only for an Approver
 * on an Imported row; hidden otherwise, never disabled.
 */

import { ApproveTransactionDialog } from '@/components/transactions/ApproveTransactionDialog';
import { RejectTransactionDialog } from '@/components/transactions/RejectTransactionDialog';
import type { DecisionActivity } from '@/components/transactions/decisionConflict';
import type {
  TransactionDetails,
  TransactionListItem,
} from '@/types/api-generated';

export function TransactionRowActions({
  item,
  onSettled,
  onActivityChange,
}: {
  item: TransactionListItem;
  /** The back-end's answer to a decision (see the Approve / Reject dialogs). */
  onSettled: (details: TransactionDetails | null) => void;
  /** Whether Approve / Reject is closed, open, or sending (for the list). */
  onActivityChange?: (activity: DecisionActivity) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ApproveTransactionDialog
        transactionId={item.id}
        reference={item.reference}
        onSettled={onSettled}
        onActivityChange={onActivityChange}
      />
      <RejectTransactionDialog
        transactionId={item.id}
        reference={item.reference}
        onSettled={onSettled}
        onActivityChange={onActivityChange}
      />
    </div>
  );
}
