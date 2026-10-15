# Story 3: Shared success and problem messages

- **Epic:** sign-in-and-app-shell
- **Slug:** story-3-shared-messages
- **Roles:** All Roles
- **Route:** null (not routable)
- **Page action:** modify_existing
- **Infrastructure only:** false
- **Requirement IDs:** R16, BR10, NFR-5
- **Target file:** app-frontend/src/contexts/ToastContext.tsx (with components/toast/Toast.tsx and ToastContainer.tsx)

## Plain summary

One consistent way of showing messages across the whole app. Success messages disappear on their own after a few seconds. Problems that need attention stay on screen until they are dealt with, and every message says what happened in words, not only by colour.

## Technical summary

- **One shared mechanism.** Change the existing `ToastContext`, `Toast` and `ToastContainer` into the single shared message mechanism (BR10).
- **Success messages.** Auto-dismiss after a set few seconds.
- **Problem messages.** Never auto-dismiss. They stay until the person dismisses them or the problem is resolved.
- **Words, not only colour.** Every message carries a text label as well as colour (NFR-5).
- **Screen readers.** Every message is announced: a polite live region for success, an assertive one for problems.
- **Root layout.** The container moves into the replaced root layout.
- **Reuse.** Move the sign-in screen's connection problem onto this pattern. Later epics reuse it.

## Acceptance criteria

- **AC-1** (coverage: vitest): A success message disappears on its own after a few seconds.
- **AC-2** (coverage: vitest): A problem message stays on screen until the person dismisses it or the problem is resolved. It never disappears on a timer.
- **AC-3** (coverage: vitest): Every message states its kind in words (for example "Success" or "Problem") as well as by colour, and is announced to screen-reader users.
- **AC-4** (coverage: vitest): Messages can be dismissed with the keyboard alone, and the dismiss button has a visible label on hover and focus.

Additional technical checks (1): announcement politeness differs by message kind.

## Manual test checklist

- Stop the back-end and try to sign in. The connection-problem message stays on screen and does not fade away by itself.
- Look at a message. It says what kind of message it is in words, not just in colour.
- Tab to a message's close button and press Enter. The message closes.

## Infrastructure reuse notes

- **Extend, don't rebuild.** `ToastContext`, `Toast` and `ToastContainer` (`src/contexts`, `src/components/toast`, `src/types/toast.ts`) already support auto-dismiss durations. Extend them into the BR10 pattern rather than building a new one.
- **One timer.** `Toast.tsx` and `ToastContext.tsx` each run their own `setTimeout`. Consolidate them into one timer.
