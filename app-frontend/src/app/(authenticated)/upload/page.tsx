import { RouteGuard } from '@/components/shell/RouteGuard';
import { UploadForm } from '@/components/upload/UploadForm';

/** The Importer's Upload screen (UP-01..UP-07); Approvers get the no-access message. */
export default function UploadPage() {
  return (
    <RouteGuard route="/upload">
      <UploadForm />
    </RouteGuard>
  );
}
