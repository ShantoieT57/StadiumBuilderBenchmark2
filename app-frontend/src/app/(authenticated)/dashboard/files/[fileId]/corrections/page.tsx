import { CorrectionsView } from '@/components/files/CorrectionsView';
import { RouteGuard } from '@/components/shell/RouteGuard';

/**
 * Correct invalid rows: the rows of a file that failed because of invalid rows,
 * editable, with "Save changes" and "Check again". Importers only (the access
 * row is kept out of the menu; the screen is reached from the file's details).
 */
export default async function CorrectionsPage({
  params,
}: {
  params: Promise<{ fileId: string }>;
}) {
  const { fileId } = await params;
  return (
    <RouteGuard route="/dashboard/files/[fileId]/corrections">
      {/* Keyed so moving to another file starts fresh. */}
      <CorrectionsView key={fileId} fileId={fileId} />
    </RouteGuard>
  );
}
