import { redirect } from 'next/navigation';

import { landingPathFor } from '@/lib/auth/landing';
import { requireSession } from '@/lib/auth/requireSession';

/**
 * `/` has no screen of its own: a signed-in person goes to their role's
 * landing page (SI-05). Anyone else is sent to sign-in by `requireSession`
 * (and by the `(authenticated)` layout). Decided server-side.
 */
export default async function RootPage() {
  const user = await requireSession();
  redirect(landingPathFor(user.role));
}
