'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MenuIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { menuItemsFor, type AppRoute } from '@/lib/auth/access';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/types/api-generated';

const MENU_LABEL = 'Menu';

interface AppNavProps {
  role: UserRole;
  /** Optional per-item extras (e.g. a count badge) rendered after the label. */
  badges?: Partial<Record<AppRoute, React.ReactNode>>;
}

const linkClass =
  'hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium outline-none focus-visible:ring-[3px]';

function isCurrent(pathname: string | null, route: AppRoute): boolean {
  return pathname === route || (pathname?.startsWith(`${route}/`) ?? false);
}

/**
 * The role-filtered main menu (BR1 / R10), built from the shared access map.
 * Items a role cannot use are not rendered. At wide widths the links sit inline
 * in one `<nav>`; below `md` they fold into an icon-only menu button that opens
 * a Sheet holding the same links (NFR-3).
 */
export function AppNav({ role, badges }: AppNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = menuItemsFor(role);

  const renderLinks = (onFollow?: () => void) =>
    items.map((item) => {
      const current = isCurrent(pathname, item.route);
      return (
        <li key={item.route}>
          <Link
            href={item.route}
            aria-current={current ? 'page' : undefined}
            className={cn(linkClass, current && 'bg-accent')}
            onClick={onFollow}
          >
            {item.label}
            {badges?.[item.route]}
          </Link>
        </li>
      );
    });

  return (
    <>
      <nav aria-label="Main" className="hidden md:block">
        <ul className="flex items-center gap-1">{renderLinks()}</ul>
      </nav>

      <Sheet open={open} onOpenChange={setOpen}>
        {/* A label-only tooltip: it closes as soon as the pointer leaves the button. */}
        <TooltipProvider disableHoverableContent>
          <Tooltip>
            <TooltipTrigger asChild>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  aria-label={MENU_LABEL}
                >
                  <MenuIcon aria-hidden="true" />
                </Button>
              </SheetTrigger>
            </TooltipTrigger>
            <TooltipContent>{MENU_LABEL}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <SheetContent side="left">
          <SheetHeader>
            <SheetTitle>{MENU_LABEL}</SheetTitle>
            <SheetDescription className="sr-only">
              Choose a screen to open.
            </SheetDescription>
          </SheetHeader>
          <ul className="flex flex-col gap-1 px-4">
            {renderLinks(() => setOpen(false))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
