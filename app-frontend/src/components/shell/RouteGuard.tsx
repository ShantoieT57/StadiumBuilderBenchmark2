import { NoAccess } from '@/components/shell/NoAccess';
import { canAccess, type AppRoute } from '@/lib/auth/access';
import { requireSession } from '@/lib/auth/requireSession';

interface RouteGuardProps {
  route: AppRoute;
  children: React.ReactNode;
}

/**
 * Server-side role check for one signed-in screen (BR3 / R12). Runs before the
 * screen renders, on every navigation to it, and reads the same access map as
 * the menu. A disallowed role gets the no-access message instead of the
 * screen's content; nobody signed in is sent to sign-in.
 */
export async function RouteGuard({ route, children }: RouteGuardProps) {
  const user = await requireSession();
  if (!canAccess(user.role, route)) {
    return <NoAccess />;
  }
  return children;
}
