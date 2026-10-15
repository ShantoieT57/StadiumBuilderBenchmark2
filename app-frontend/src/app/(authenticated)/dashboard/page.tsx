import { Suspense } from 'react';

import { DashboardCounts } from '@/components/files/DashboardCounts';
import { FileFilters } from '@/components/files/FileFilters';
import { DashboardFilesList } from '@/components/files/DashboardFilesList';
import { RouteGuard } from '@/components/shell/RouteGuard';
import { requireSession } from '@/lib/auth/requireSession';

/**
 * Dashboard: every file, sortable and paged, for both roles. The status and
 * transaction counts sit above the list (loading on their own, so neither
 * blocks the other) and the filters beside it.
 */
export default async function DashboardPage() {
  const user = await requireSession();
  return (
    <RouteGuard route="/dashboard">
      <div className="flex min-w-0 flex-col gap-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Suspense
          fallback={
            <section aria-label="Dashboard summary">
              <p className="text-muted-foreground">Loading counts…</p>
            </section>
          }
        >
          <DashboardCounts />
        </Suspense>
        <Suspense
          fallback={<p className="text-muted-foreground">Loading files…</p>}
        >
          <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
            <div className="min-w-0 lg:w-72 lg:shrink-0">
              <FileFilters />
            </div>
            <div className="min-w-0 flex-1">
              <DashboardFilesList role={user.role} />
            </div>
          </div>
        </Suspense>
      </div>
    </RouteGuard>
  );
}
