import { redirect } from 'next/navigation';

import { landingPathFor } from '@/lib/auth/landing';
import { checkSession, signInPathFor } from '@/lib/server/session';

/**
 * `/` has no screen of its own: a signed-in person goes to their role's
 * landing page (SI-05), anyone else to sign-in. Decided server-side.
 */
export default async function RootPage() {
  const session = await checkSession();
  if (session.status === 'signed-in') {
    redirect(landingPathFor(session.user.role));
  }
  redirect(signInPathFor(session));
}
