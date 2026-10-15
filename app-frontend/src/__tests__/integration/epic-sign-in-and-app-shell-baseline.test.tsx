/**
 * Per-epic baseline: sign-in-and-app-shell
 *
 * Cross-story invariants of the shared signed-in shell, created by Story 1 (the
 * story that introduces the `(signed-in)` route group and its layout). Later
 * stories in this epic do NOT re-assert these; extend this file only with
 * genuinely new shared-surface invariants.
 *
 * Story Metadata (shared surface introduced by Story 1):
 * - Route: /upload, /transactions (any route inside the (signed-in) group)
 * - Target File: app-frontend/src/app/(signed-in)/layout.tsx
 * - Components under test:
 *   - app-frontend/src/components/shell/SignedInHeader.tsx (named export
 *     `SignedInHeader`, props `{ user: CurrentUser }`) - the shell's top bar,
 *     rendered as a <header> (banner landmark), showing the person's name and role
 *     each in its own element (R9).
 *   - app-frontend/src/lib/auth/landing.ts (named export `landingPathFor(role)`) -
 *     the single role -> landing-page map used by the sign-in redirect and by `/`
 *     (BR2). Later stories and epics read it rather than re-deriving it.
 *
 * Runtime-only aspects (the server-side /auth/me gate and its redirect) are
 * covered by the Playwright spec, not here.
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { render, screen, within } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { SignedInHeader } from '@/components/shell/SignedInHeader';
import { landingPathFor } from '@/lib/auth/landing';
import { userInfoFor } from '@/mocks/data/identity';
import type { UserRole } from '@/types/api-generated';

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/upload',
  useSearchParams: () => new URLSearchParams(),
}));

describe('Epic sign-in-and-app-shell baseline: signed-in shell', () => {
  // Baseline (R9) - every signed-in screen shows who is signed in
  it.each<UserRole>(['Importer', 'Approver'])(
    'the shell header shows the signed-in %s by name and role',
    (role) => {
      const user = userInfoFor(role);
      render(<SignedInHeader user={user} />);

      const banner = screen.getByRole('banner');
      expect(within(banner).getByText(user.name)).toBeInTheDocument();
      expect(within(banner).getByText(user.role)).toBeInTheDocument();
    },
  );

  // Baseline (BR2) - one role -> landing-page map shared by sign-in and `/`
  it.each<[UserRole, string]>([
    ['Importer', '/upload'],
    ['Approver', '/transactions'],
  ])('a signed-in %s lands on %s', (role, path) => {
    expect(landingPathFor(role)).toBe(path);
  });
});
