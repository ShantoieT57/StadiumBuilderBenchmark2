import { AppNav } from '@/components/shell/AppNav';
import { SessionRecheck } from '@/components/shell/SessionRecheck';
import { SignedInHeader } from '@/components/shell/SignedInHeader';
import { SignOutButton } from '@/components/shell/SignOutButton';
import { EventsProvider } from '@/contexts/EventsContext';
import { requireSession } from '@/lib/auth/requireSession';

/**
 * The signed-in shell (BR3 / NFR-1). Gated server-side: the session is checked
 * against the back-end before anything renders, and anyone not signed in is
 * redirected to sign-in (with the 401 `reason`), so protected content never
 * flashes. Each screen's role check runs in the page itself (`RouteGuard`),
 * because a layout is not re-rendered on client-side navigation between its
 * pages.
 *
 * Rendered per request (it reads the session cookie), so every signed-in page
 * is served `Cache-Control: no-store` and the Back button cannot replay one
 * after sign-out; `SessionRecheck` covers a back/forward-cache restore. The
 * shell holds the tab's single live connection (`EventsProvider`).
 */
export const dynamic = 'force-dynamic';

export default async function SignedInLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireSession();

  return (
    <EventsProvider>
      <SessionRecheck />
      <div className="flex min-h-screen flex-col">
        <SignedInHeader
          user={user}
          nav={<AppNav role={user.role} />}
          actions={<SignOutButton />}
        />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
          {children}
        </main>
      </div>
    </EventsProvider>
  );
}
