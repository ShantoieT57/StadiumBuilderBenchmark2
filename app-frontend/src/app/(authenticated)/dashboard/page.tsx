import { RouteGuard } from '@/components/shell/RouteGuard';

/** Placeholder: the Dashboard. Replaced by a later epic. */
export default function DashboardPage() {
  return (
    <RouteGuard route="/dashboard">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">
          An overview of files and transactions is coming soon.
        </p>
      </div>
    </RouteGuard>
  );
}
