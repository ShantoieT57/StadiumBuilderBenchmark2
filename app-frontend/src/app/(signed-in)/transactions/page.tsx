import { RouteGuard } from '@/components/shell/RouteGuard';

/** Placeholder: the Approver's landing page. Replaced by the transactions epic. */
export default function TransactionsPage() {
  return (
    <RouteGuard route="/transactions">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <p className="text-muted-foreground">
          Reviewing and approving transactions is coming soon.
        </p>
      </div>
    </RouteGuard>
  );
}
