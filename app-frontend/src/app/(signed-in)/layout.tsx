import { redirect } from 'next/navigation';

import { SignedInHeader } from '@/components/shell/SignedInHeader';
import { checkSession, signInPathFor } from '@/lib/server/session';

/**
 * The signed-in shell (BR3 / NFR-1). Gated server-side: the session is checked
 * against the back-end before anything renders, and anyone not signed in is
 * redirected to sign-in, so protected content never flashes.
 */
export default async function SignedInLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await checkSession();
  if (session.status !== 'signed-in') {
    redirect(signInPathFor(session));
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SignedInHeader user={session.user} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
