import { RouteGuard } from '@/components/shell/RouteGuard';
import { TransactionDetailsView } from '@/components/transactions/TransactionDetailsView';

/**
 * Transaction details (TL-06): every field of one transaction, for both roles,
 * guarded by the same access row as the list.
 */
export default async function TransactionDetailsPage({
  params,
}: {
  params: Promise<{ transactionId: string }>;
}) {
  const { transactionId } = await params;
  return (
    <RouteGuard route="/transactions">
      <TransactionDetailsView transactionId={transactionId} />
    </RouteGuard>
  );
}
