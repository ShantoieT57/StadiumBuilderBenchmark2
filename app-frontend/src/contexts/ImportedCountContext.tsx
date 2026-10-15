'use client';

/**
 * The Approver's "waiting for review" count on the Transactions menu item.
 *
 * `useImportedCount().refreshImportedCount()` asks the count to refetch after this
 * person's own approve / reject (including a "someone got there first" answer).
 * Outside a provider (Importer screens, tests without the shell) it is a no-op,
 * so callers never need to check.
 *
 * The provider that loads and shows the count is added with the menu badge.
 */

import { createContext, useContext } from 'react';

export interface ImportedCountContextValue {
  /** The last known count, or null before the first successful load. */
  count: number | null;
  /** Refetches the count; never throws. */
  refreshImportedCount: () => void;
}

const NO_COUNT: ImportedCountContextValue = {
  count: null,
  refreshImportedCount: () => undefined,
};

export const ImportedCountContext =
  createContext<ImportedCountContextValue>(NO_COUNT);

export function useImportedCount(): ImportedCountContextValue {
  return useContext(ImportedCountContext);
}
