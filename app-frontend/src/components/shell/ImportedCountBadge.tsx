'use client';

import { Badge } from '@/components/ui/badge';
import { useImportedCount } from '@/contexts/ImportedCountContext';

/** Above this the badge reads "99+" (BR7). */
export const MAX_SHOWN_COUNT = 99;

/** The badge text for `count`: exact up to 99, "99+" above. */
export function shownCount(count: number): string {
  return count > MAX_SHOWN_COUNT ? `${MAX_SHOWN_COUNT}+` : String(count);
}

/**
 * The Approver's waiting count after the "Transactions" menu label (R2). Shows
 * nothing at zero or before the first successful load. Screen readers hear
 * "Transactions, <N> waiting for review" rather than a bare number.
 */
export function ImportedCountBadge() {
  const { count } = useImportedCount();
  if (count === null || count <= 0) return null;

  return (
    <>
      <span className="sr-only">, </span>
      <Badge>
        {shownCount(count)}
        <span className="sr-only"> waiting for review</span>
      </Badge>
    </>
  );
}
