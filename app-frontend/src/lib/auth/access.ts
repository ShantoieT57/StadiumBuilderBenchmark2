/**
 * The single route -> role access map (BR1 / R10 / R12). The menu is built from
 * it and the server-side route guard enforces it, so what is hidden and what is
 * refused can never drift apart. Later epics add rows here.
 */
import type { UserRole } from '@/types/api-generated';

/** Every signed-in screen that has an access rule. */
export type AppRoute = '/dashboard' | '/transactions' | '/upload';

export interface RouteAccess {
  route: AppRoute;
  /** Menu label. */
  label: string;
  /** Roles allowed to open the screen (and to see its menu item). */
  roles: readonly UserRole[];
}

/** Menu order is the order of this list. */
export const ROUTE_ACCESS: readonly RouteAccess[] = [
  { route: '/dashboard', label: 'Dashboard', roles: ['Importer', 'Approver'] },
  // Importers see Transactions view only; that is enforced inside the screen.
  {
    route: '/transactions',
    label: 'Transactions',
    roles: ['Importer', 'Approver'],
  },
  { route: '/upload', label: 'Upload', roles: ['Importer'] },
];

/** Whether a person holding `role` may open `route`. */
export function canAccess(role: UserRole, route: AppRoute): boolean {
  return ROUTE_ACCESS.some(
    (entry) => entry.route === route && entry.roles.includes(role),
  );
}

/** The menu items a person holding `role` may use, in menu order. */
export function menuItemsFor(role: UserRole): readonly RouteAccess[] {
  return ROUTE_ACCESS.filter((entry) => entry.roles.includes(role));
}
