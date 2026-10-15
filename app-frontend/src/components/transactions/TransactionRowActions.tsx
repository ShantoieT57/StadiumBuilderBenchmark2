'use client';

/**
 * The Approver's decisions on one transaction row (R1, BR1): Approve and Reject,
 * as text buttons with the reference in a visually hidden suffix ("Approve
 * <reference>", "Reject <reference>"). Rendered by the list only for an Approver
 * on an Imported row; hidden otherwise, never disabled.
 */

import { ApproveTransactionDialog } from '@/components/transactions/ApproveTransactionDialog';
import { Button } from '@/components/ui/button';
import type {
  TransactionDetails,
  TransactionListItem,
} from '@/types/api-generated';

export const REJECT_LABEL = 'Reject';

export function TransactionRowActions({
  item,
  onSettled,
}: {
  item: TransactionListItem;
  /** The back-end's answer to a decision (see `ApproveTransactionDialog`). */
  onSettled: (details: TransactionDetails | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ApproveTransactionDialog
        transactionId={item.id}
        reference={item.reference}
        onSettled={onSettled}
      />
      {/* The reject confirmation (reason form) is wired here by the Reject story. */}
      <Button type="button" variant="outline" size="sm">
        {`${REJECT_LABEL} `}
        <span className="sr-only">{item.reference}</span>
      </Button>
    </div>
  );
}
