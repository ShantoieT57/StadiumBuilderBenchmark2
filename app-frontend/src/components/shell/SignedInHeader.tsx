import { APP_NAME } from '@/lib/auth/messages';
import type { CurrentUser } from '@/types/api-generated';

interface SignedInHeaderProps {
  user: CurrentUser;
}

/**
 * The signed-in shell's top bar (banner landmark). Always shows who is signed
 * in: their name and their role, each in its own element (SI-09).
 */
export function SignedInHeader({ user }: SignedInHeaderProps) {
  return (
    <header className="bg-card border-b">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3">
        <p className="font-semibold">{APP_NAME}</p>
        <div className="flex flex-col items-end text-sm">
          <span className="sr-only">Signed in as</span>
          <span className="font-medium">{user.name}</span>
          <span className="text-muted-foreground">{user.role}</span>
        </div>
      </div>
    </header>
  );
}
