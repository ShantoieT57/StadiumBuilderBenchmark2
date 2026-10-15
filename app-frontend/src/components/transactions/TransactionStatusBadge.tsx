import { Badge } from '@/components/ui/badge';
import { formatTransactionStatus } from '@/lib/format/transaction';
import { cn } from '@/lib/utils';
import type { TransactionStatus } from '@/types/api-generated';

/** Status colour tokens; the status is always shown in words as well (BR5). */
const STATUS_STYLES: Record<TransactionStatus, string> = {
  Imported: 'border-warning text-warning',
  Approved: 'border-success text-success',
  Rejected: 'border-destructive text-destructive',
};

export function TransactionStatusBadge({
  status,
  className,
}: {
  status: TransactionStatus;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn('bg-background', STATUS_STYLES[status], className)}
    >
      {formatTransactionStatus(status)}
    </Badge>
  );
}
