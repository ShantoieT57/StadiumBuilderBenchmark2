import { Suspense } from 'react';

import { FilesList } from '@/components/files/FilesList';
import { RouteGuard } from '@/components/shell/RouteGuard';
import { requireSession } from '@/lib/auth/requireSession';

/**
 * Dashboard: every file, sortable and paged, for both roles. The counts
 * (story 3) sit above the list and the filters (story 2) beside it.
 */
export default async function DashboardPage() {
  const user = await requireSession();
  return (
    <RouteGuard route="/dashboard">
      <div className="flex min-w-0 flex-col gap-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        {/* Slot: <DashboardCounts /> (file and transaction counts). */}
        <Suspense
          fallback={<p className="text-muted-foreground">Loading files…</p>}
        >
          <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
            {/* Slot: <FileFilters /> in a `min-w-0 lg:w-72 lg:shrink-0` column. */}
            <div className="min-w-0 flex-1">
              <FilesList role={user.role} />
            </div>
          </div>
        </Suspense>
      </div>
    </RouteGuard>
  );
}
