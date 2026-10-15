import { redirect } from 'next/navigation';

import { AppNav } from '@/components/shell/AppNav';
import { SignedInHeader } from '@/components/shell/SignedInHeader';
import { currentSession, signInPathFor } from '@/lib/server/session';

/**
 * The signed-in shell (BR3 / NFR-1). Gated server-side: the session is checked
 * against the back-end before anything renders, and anyone not signed in is
 * redirected to sign-in, so protected content never flashes. Each screen's
 * role check runs in the page itself (`RouteGuard`), because a layout is not
 * re-rendered on client-side navigation between its pages.
 */
export default async function SignedInLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await currentSession();
  if (session.status !== 'signed-in') {
    redirect(signInPathFor(session));
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SignedInHeader
        user={session.user}
        nav={<AppNav role={session.user.role} />}
      />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
