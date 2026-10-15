import { NO_ACCESS_MESSAGE, NO_ACCESS_TITLE } from '@/lib/auth/messages';

/**
 * Shown inside the signed-in shell when a person opens a screen their role does
 * not allow (R11). Not an error page: the header and menu stay in place.
 */
export function NoAccess() {
  return (
    <section aria-labelledby="no-access-title" className="flex flex-col gap-2">
      <h1 id="no-access-title" className="text-2xl font-semibold">
        {NO_ACCESS_TITLE}
      </h1>
      <p className="text-muted-foreground">{NO_ACCESS_MESSAGE}</p>
    </section>
  );
}
