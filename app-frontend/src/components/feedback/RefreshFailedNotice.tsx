/**
 * A small, non-blocking problem shown when a background refresh (a live event,
 * a resync, or a reload after the first successful load) fails: the screen keeps
 * the data it already shows, and this notice offers Retry. The full problem
 * that replaces the content is only for a first load that fails.
 */

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const REFRESH_FAILED_MESSAGE = "Couldn't refresh — showing earlier data";

export function RefreshFailedNotice({
  onRetry,
  className,
}: {
  onRetry: () => void;
  className?: string;
}) {
  return (
    <Alert variant="destructive" className={cn('py-2', className)}>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <p>{REFRESH_FAILED_MESSAGE}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}
