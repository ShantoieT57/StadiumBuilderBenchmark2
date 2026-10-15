/**
 * Project-wide mock factory for the CurrentUser entity (GET /auth/me body).
 *
 * Shared by Vitest and Playwright. Imports are type-only and relative so the
 * Playwright runtime can load this file without `@/` alias plumbing.
 */
import type { CurrentUser } from '../../types/api-generated';

/** Canonical default: the seeded importer user. */
export function createCurrentUser(
  overrides: Partial<CurrentUser> = {},
): CurrentUser {
  return {
    name: 'File Importer',
    email: 'fileimporter@digiata.com',
    role: 'Importer',
    ...overrides,
  };
}
