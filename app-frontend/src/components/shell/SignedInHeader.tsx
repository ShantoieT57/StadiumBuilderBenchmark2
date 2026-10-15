import { APP_NAME } from '@/lib/auth/messages';
import type { CurrentUser } from '@/types/api-generated';

interface SignedInHeaderProps {
  user: CurrentUser;
  /** The main menu, placed between the app name and the signed-in person. */
  nav?: React.ReactNode;
}

/**
 * The signed-in shell's top bar (banner landmark). Always shows who is signed
 * in: their name and their role, each in its own element (SI-09).
 */
export function SignedInHeader({ user, nav }: SignedInHeaderProps) {
  return (
    <header className="bg-card border-b">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 md:gap-6">
          <p className="font-semibold">{APP_NAME}</p>
          {nav}
        </div>
        <div className="flex shrink-0 flex-col items-end text-sm">
          <span className="sr-only">Signed in as</span>
          <span className="font-medium">{user.name}</span>
          <span className="text-muted-foreground">{user.role}</span>
        </div>
      </div>
    </header>
  );
}
