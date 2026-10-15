import { Badge } from '@/components/ui/badge';
import { CANCELLED_LABEL, formatFileStatus } from '@/lib/format/file';
import { cn } from '@/lib/utils';
import type { FileStatus } from '@/types/api-generated';

/** Status colour tokens; the status is always shown in words as well. */
const STATUS_STYLES: Record<FileStatus, string> = {
  Uploaded: 'border-border text-foreground',
  Processing: 'border-warning text-warning',
  Completed: 'border-success text-success',
  Failed: 'border-destructive text-destructive',
};

export function FileStatusBadge({
  status,
  className,
}: {
  status: FileStatus;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn('bg-background', STATUS_STYLES[status], className)}
    >
      {formatFileStatus(status)}
    </Badge>
  );
}

/** The extra "Cancelled" marker shown beside a cancelled file's status. */
export function FileCancelledBadge({ className }: { className?: string }) {
  return (
    <Badge variant="secondary" className={className}>
      {CANCELLED_LABEL}
    </Badge>
  );
}
