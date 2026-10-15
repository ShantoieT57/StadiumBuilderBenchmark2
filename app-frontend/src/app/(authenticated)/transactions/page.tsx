import { Suspense } from 'react';

import { RouteGuard } from '@/components/shell/RouteGuard';
import { TransactionFilters } from '@/components/transactions/TransactionFilters';
import { TransactionsList } from '@/components/transactions/TransactionsList';
import { requireSession } from '@/lib/auth/requireSession';

/**
 * Transactions: every transaction, filtered, sortable and paged, for both roles
 * (TL-01..03, R6-R9). The filters sit beside the list on wide screens, above it
 * on tablets, and in a slide-out panel on phones. An Approver also approves and
 * rejects Imported transactions from the list.
 */
export default async function TransactionsPage() {
  const user = await requireSession();
  return (
    <RouteGuard route="/transactions">
      <div className="flex min-w-0 flex-col gap-4">
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <Suspense
          fallback={
            <p className="text-muted-foreground">Loading transactions…</p>
          }
        >
          <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
            <div className="min-w-0 lg:w-72 lg:shrink-0">
              <TransactionFilters />
            </div>
            <div className="min-w-0 flex-1">
              <TransactionsList role={user.role} />
            </div>
          </div>
        </Suspense>
      </div>
    </RouteGuard>
  );
}
