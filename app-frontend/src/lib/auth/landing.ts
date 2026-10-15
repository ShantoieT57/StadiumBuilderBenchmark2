/**
 * The single role -> landing-page map (SI-05 / BR2). Used by the sign-in
 * redirect and by `/`. Read it rather than re-deriving it.
 */
import type { UserRole } from '@/types/api-generated';

const LANDING_PATHS: Record<UserRole, string> = {
  Importer: '/upload',
  Approver: '/transactions',
};

/** Where a person holding `role` lands after signing in. */
export function landingPathFor(role: UserRole): string {
  return LANDING_PATHS[role];
}
