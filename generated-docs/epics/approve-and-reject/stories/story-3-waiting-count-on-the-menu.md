# Story 3: Waiting count on the Transactions menu item

- **Epic:** approve-and-reject
- **Slug:** story-3-waiting-count-on-the-menu
- **Roles:** Approver, Importer
- **Route:** /transactions
- **Page action:** modify_existing
- **Infrastructure only:** false
- **Requirement IDs:** R2, BR7, BR8, GN-01, NFR (same-origin proxy), NFR (error state with retry)
- **Target file:** app-frontend/src/app/(authenticated)/layout.tsx

## Plain summary

For Approvers, the Transactions menu item shows how many transactions are still Imported: the exact number up to 99, "99+" above that, and nothing at zero. It goes down as soon as the Approver approves or rejects one, and it keeps up when someone else does. Importers never see it.

## Technical summary

- **Provider.** New `contexts/ImportedCountContext.tsx`: `ImportedCountProvider` (mounted inside `EventsProvider` in the `(authenticated)` layout, Approver only) loads `getImportedTransactionCount()` on mount, refetches on `transactions-changed` and `resync` via `useEvents().subscribe`, and exposes `refreshImportedCount()` through `useImportedCount()`. The hook returns a no-op outside the provider, so Importer screens and stories 1-2's calls are safe (BR8).
- **Badge (R2, BR7).** New `components/shell/ImportedCountBadge.tsx`: shadcn Badge with `count <= 99 ? count : '99+'`, rendered nothing at 0 or before the first load; accessible text "<N> waiting for review" (visually hidden suffix) so the link reads "Transactions, 15 waiting for review". The layout passes it via `AppNav`'s `badges={{ '/transactions': <ImportedCountBadge /> }}` only when `user.role === 'Approver'`; shown in both the inline menu (md+) and the phone Sheet menu (GN-01).
- **Own actions.** Stories 1-2 call `refreshImportedCount()` after a successful approve / reject and after a 409.
- **Failures.** A failed count load keeps the last known count (or no badge before the first success) with no problem message, and is retried on the next event or own action; ignore when `isRedirectingToSignIn`. The count is decorative next to the list, which carries its own error states.
- **Requests.** Importers never call `GET /transactions/imported-count` (it would answer 403).

## Acceptance criteria

- **AC-1** (coverage: vitest): For an Approver, the Transactions menu item shows the number of Imported transactions exactly up to 99, "99+" above 99, and no badge at zero; an Importer never sees a badge.
- **AC-2** (coverage: playwright): After the Approver approves or rejects a transaction, the menu count goes down by one straight away, without reloading the page, in both the wide-screen menu and the phone menu.
- **AC-3** (coverage: playwright): When someone else's approval or rejection is announced, or the app re-syncs, the menu count updates to the current number without a reload.
- **AC-4** (coverage: vitest): If the count cannot be loaded, the menu keeps the last known count (or no badge) without blocking the menu, and picks up the right number on the next update.

Additional technical checks (2):
- An Importer's session never requests the waiting count.
- The badge reads as "<N> waiting for review" to screen readers, not a bare number.

## Manual test checklist

- Sign in as the Approver → the Transactions menu item shows the number of Imported transactions (it matches the "Imported" count on the Dashboard).
- Approve one transaction → the number drops by one straight away; reject another → it drops again.
- Keep the Approver signed in in one browser and, in another browser as a second Approver session, approve a transaction → the first browser's count drops without a reload.
- Narrow the browser to phone width and open the menu → the count shows next to Transactions there too.
- Sign in as the Importer → no number next to Transactions.

## Resolved design choices (defaults chosen; stories approval delegated)

- The count is a small badge right after the "Transactions" label, in both the wide-screen and phone menus, read aloud as "N waiting for review".
- If the count fails to load, it quietly keeps the last number (or shows none) rather than showing a problem message; the list itself reports load problems.
- The count is refreshed after the Approver's own decision (including a "someone got there first" answer), on another person's change, and on re-sync; there is no timer-based polling.

## Infrastructure reuse notes

- **Endpoint.** `getImportedTransactionCount()` in `lib/api/endpoints.ts` returns `{ count }`; the proxy allowlist already has GET imported-count.
- **Menu.** `AppNav` already takes a per-route `badges` slot (rendered after the label, inline and in the Sheet); the layout already has `user.role`.
- **Live updates.** `EventsProvider` / `useEvents().subscribe('transactions-changed' | 'resync', ...)`; no new EventSource.
- **Primitives.** shadcn Badge (installed).
- **E2E mock.** Extend `app-frontend/e2e/fixtures/mock-backend.ts` with GET `/transactions/imported-count` with real semantics: Approver only (403 for Importer), `{ count }` = Imported transactions in the request's `mock-run` state, so it drops after approve / reject in the same run. The mock does not emit live events: AC-3 stubs `/api/events` (as earlier specs do) to deliver `transactions-changed` / `resync` after changing state through the mock.
