import { FileDetailsView } from '@/components/files/FileDetailsView';
import { RouteGuard } from '@/components/shell/RouteGuard';
import { requireSession } from '@/lib/auth/requireSession';

/**
 * File details: one file's summary, transaction counts and processing history,
 * for both roles, guarded by the Dashboard's access row. The signed-in role
 * decides which file actions are offered.
 */
export default async function FileDetailsPage({
  params,
}: {
  params: Promise<{ fileId: string }>;
}) {
  const { fileId } = await params;
  const user = await requireSession();
  return (
    <RouteGuard route="/dashboard">
      {/* Keyed so moving to another file starts fresh, never showing the previous one's details. */}
      <FileDetailsView key={fileId} fileId={fileId} role={user.role} />
    </RouteGuard>
  );
}
