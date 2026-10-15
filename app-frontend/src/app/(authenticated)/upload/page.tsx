import { RouteGuard } from '@/components/shell/RouteGuard';

/** Placeholder: the Importer's landing page. Replaced by the upload epic. */
export default function UploadPage() {
  return (
    <RouteGuard route="/upload">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Upload</h1>
        <p className="text-muted-foreground">
          Uploading bank transaction files is coming soon.
        </p>
      </div>
    </RouteGuard>
  );
}
