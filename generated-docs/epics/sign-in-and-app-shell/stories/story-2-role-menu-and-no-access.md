# Story 2: Role-based menu and no-access screen

- **Epic:** sign-in-and-app-shell
- **Slug:** story-2-role-menu-and-no-access
- **Roles:** Importer, Approver
- **Route:** /dashboard
- **Page action:** modify_existing
- **Infrastructure only:** false
- **Requirement IDs:** R10, R11, R12, R13, R14, BR1, BR3, NFR-3
- **Target file:** app-frontend/src/app/(signed-in)/layout.tsx (navigation component in components/, access map in lib/auth/, (signed-in)/dashboard/page.tsx placeholder)

## Plain summary

The menu shows only what each role may use. Importers see Dashboard, Transactions and Upload. Approvers see Dashboard and Transactions. If someone opens a saved link to a screen their role doesn't allow, they see a message saying they don't have access and should ask their administrator. On narrow screens the menu folds into a menu button, and everything works with the keyboard alone.

## Technical summary

- **Role-filtered navigation.** Add it to the signed-in layout, driven by one route-to-role access map shared by the menu and the server-side route guard.
  - Items a role cannot use are not rendered (hidden, not disabled).
  - Leave a slot for the later Imported-count badge on Transactions.
- **Dashboard placeholder.** Add a minimal Dashboard placeholder page.
- **Server-side role check.** Runs on each signed-in route. A disallowed role sees a no-access message inside the shell, not an error page. The message names the administrator, using the 403 message pattern.
- **Narrow screens.** Below about 768px the menu collapses into a labelled menu button (shadcn Sheet or DropdownMenu).
- **Tooltips.** Icon-only buttons get tooltips on hover and on keyboard focus.
- **Keyboard.** Focus is visible, and the whole shell can be used with the keyboard alone.

## Acceptance criteria

- **AC-1** (coverage: vitest): An Importer's menu shows Dashboard, Transactions and Upload. An Approver's menu shows Dashboard and Transactions, with no Upload item at all (not a disabled one).
- **AC-2** (coverage: playwright): An Approver who opens the Upload address directly sees a message inside the app saying they don't have access and should ask their administrator. No error page appears and no Upload content is shown.
- **AC-3** (coverage: playwright): On a narrow screen the menu collapses behind a labelled menu button that opens and closes, and its items can be followed.
- **AC-4** (coverage: vitest): Every icon-only button shows its label when the pointer rests on it or keyboard focus reaches it.
- **AC-5** (coverage: playwright): Every menu item and control in the shell can be reached and used with the keyboard alone, with a visible focus indicator.

Additional technical checks (1): the server-side role check runs before render, not only by hiding menu items (R12).

## Manual test checklist

- Sign in as the Importer. The menu shows Dashboard, Transactions and Upload.
- Sign in as the Approver. The menu shows Dashboard and Transactions, and Upload is nowhere to be seen.
- As the Approver, type /upload in the address bar. You see a "you don't have access, ask your administrator" message on the page (no error page).
- Narrow the browser window to phone width. The menu turns into a menu button that opens and closes and still lets you navigate.
- Use only Tab, Enter and Escape to move through the menu and open each screen. You can always see where focus is.
- Rest the pointer on the menu button, or tab to it. A label appears.

## Resolved design choices (approved at the stories approval)

- **No-access wording:** "You don't have access to this screen. Ask your administrator if you need it." Keep it in the same constants file as the forgotten-password text.

## Infrastructure reuse notes

- **One access map.** Keep a single route-to-role access map (e.g. `src/lib/auth/access.ts`) that both the menu and the server-side route guard read, so hidden and enforced never drift apart. Later epics add rows to it.
- **Menu items per the brief's table:**
  - Dashboard: both roles
  - Transactions: both roles (view only for importers)
  - Upload: Importer only
- **shadcn primitives.** Expect to add tooltip, sheet or dropdown-menu via `(cd app-frontend && npx shadcn add <component> --yes)`.
