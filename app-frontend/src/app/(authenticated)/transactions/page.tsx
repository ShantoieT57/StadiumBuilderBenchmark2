import { Suspense } from 'react';

import { RouteGuard } from '@/components/shell/RouteGuard';
import { TransactionsList } from '@/components/transactions/TransactionsList';

/** Transactions: every transaction, sortable and paged, for both roles (TL-01..03). */
export default function TransactionsPage() {
  return (
    <RouteGuard route="/transactions">
      <div className="flex min-w-0 flex-col gap-4">
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <Suspense
          fallback={
            <p className="text-muted-foreground">Loading transactions…</p>
          }
        >
          <TransactionsList />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
