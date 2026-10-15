# Story 2: Dashboard correction shortcut and who can correct

- **Epic:** file-correction-and-cancel
- **Slug:** story-2-correction-shortcut-and-guards
- **Roles:** Importer, Approver
- **Route:** /dashboard
- **Page action:** modify_existing
- **Infrastructure only:** false
- **Requirement IDs:** R11, R12, R16, BR1, BR2, BR6, NFR-2, NFR-5
- **Target file:** app-frontend/src/app/(authenticated)/dashboard/page.tsx

## Plain summary

On the Dashboard, the Importer sees a "Correct" shortcut on each file that failed because of invalid rows and goes straight to its correction screen. Files that failed as duplicates, and Approvers, get no correction controls at all, and an Approver who follows a saved link to a correction screen sees the no-access message naming who to ask. If the file is no longer waiting for corrections, for example because it was cancelled or corrected elsewhere, the correction screen says so plainly and points to the file's details instead of showing the form.

## Technical summary

- **DB-08 shortcut (R16).** The Dashboard page passes `rowActions` to `FilesList` only when `user.role === 'Importer'`: for a row with `status === 'Failed' && failureKind === 'InvalidRows' && !isCancelled`, a "Correct" link (`correctionsHref(id)` -> `/dashboard/files/<id>/corrections`, accessible name "Correct <file name>") in the table's actions column (md+) and in the compact row's actions area after Details (below md). Nothing for any other row or for Approvers (hidden, not disabled).
- **Duplicate-failed (R11, BR1).** No shortcut on the Dashboard and no "Correct invalid rows" on its details; the existing "Why it failed" panel stays as is (no retry).
- **Saved link, Approver (BR2).** The story-1 access row makes `RouteGuard` render `NoAccess` (names the administrator) for an Approver; no correction controls and no invalid-rows request.
- **Not waiting (BR6).** On opening, a 409 from `getInvalidRows` replaces the form with a notice "This file is not waiting for corrections." (the back-end's message when present) plus the file's current status in words and a "View file details" link; a 409 from Save changes / Check again shows the same notice instead of the form (edits are discarded, since the file can no longer take them) and refetches the file. A 404 shows the existing "File not found" wording.
- **Live updates (NFR-5).** The correction screen subscribes to `file-changed` for this file and `resync`: it re-fetches the file and re-asks `getInvalidRows`; a 409 switches to the not-waiting notice; if the file is still waiting, the Importer's unsaved edits are kept (the list is not overwritten mid-edit) and only the count/header refresh. A failed background refresh keeps the screen with `RefreshFailedNotice`.

## Acceptance criteria

- **AC-1** (coverage: playwright): On the Dashboard, an Importer sees a "Correct" shortcut on a file that failed because of invalid rows, and selecting it opens that file's correction screen.
- **AC-2** (coverage: vitest): No correction shortcut or "Correct invalid rows" action appears for a file that failed as a duplicate, for a file in any other status, for a cancelled file, or for an Approver.
- **AC-3** (coverage: playwright): An Approver who opens a saved link to a correction screen sees the no-access message naming who to ask, and no correction controls.
- **AC-4** (coverage: playwright): When a file is no longer waiting for corrections (cancelled or already corrected), its correction screen says so plainly and offers the way to the file's details instead of the form, whether found on opening or on "Check again".
- **AC-5** (coverage: vitest): When the file changes elsewhere while its correction screen is open, the screen updates without a refresh (switching to the "not waiting" notice if it no longer needs correcting) and keeps any edits not yet sent while it still does.

Additional technical checks (2):
- The shortcut's accessible name includes the file name, so each "Correct" link in the list is distinguishable to screen readers.
- A failed background refresh on the correction screen keeps the form with the "Couldn't refresh" notice rather than replacing it.

## Manual test checklist

- As the Importer, open the Dashboard with a file that failed because of invalid rows → its row shows a "Correct" shortcut; select it → you are on that file's correction screen.
- Check a file that failed as a duplicate → no "Correct" shortcut on the Dashboard and no correction action on its details.
- Sign in as the Approver → no "Correct" shortcuts on the Dashboard and no correction action on the failed file's details.
- As the Approver, paste a correction screen address (copied while signed in as the Importer) into the address bar → you see the no-access message naming who to ask.
- Open a file's correction screen in two tabs as the Importer, finish the corrections in one, then look at the other → it now says the file is not waiting for corrections, with a link to its details.
- At phone width, the "Correct" shortcut appears in the file's row actions next to Details and works by keyboard.

## Resolved design choices (defaults chosen; stories approval delegated)

- The Dashboard shortcut is a text link "Correct" (not an icon) in the row's actions, so it is clear without a tooltip; it is only on files that actually need correcting.
- When the file stops waiting for corrections while the screen is open, unsent edits are dropped and the notice explains why; while it is still waiting, edits are kept and never overwritten by a live refresh.
- The not-waiting notice is an inline panel on the correction screen (it describes the screen's state), not a pop-up message.

## Infrastructure reuse notes

- **List.** `FilesList` `rowActions` prop (`FileRowActions = (file: FileListItem) => ReactNode`), already rendered in the table and the compact row actions area; `FileListItem` carries `failureKind` and `isCancelled`.
- **Access.** `RouteGuard` + `NoAccess` with the story-1 Importer-only access row; the Dashboard page already has `user.role`.
- **Live.** `useEvents().subscribe('file-changed' | 'resync', ...)`; `RefreshFailedNotice` for failed background refreshes; status wording from `formatFileStatus`.
- **E2E mock.** Uses the story-1 mock routes; seed a duplicate-failed file and a cancelled invalid-rows file (409 on invalid-rows) alongside the waiting one. Approver requests to invalid-rows answer 403.
