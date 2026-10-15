# Story 2: Filter the file list and show cancelled files

- **Epic:** file-dashboard-and-details
- **Slug:** story-2-filter-file-list
- **Roles:** Importer, Approver
- **Route:** /dashboard
- **Page action:** modify_existing
- **Infrastructure only:** false
- **Requirement IDs:** R5, R6, BR4, NFR-2, NFR-3, NFR-4, NFR-5
- **Target file:** app-frontend/src/app/(authenticated)/dashboard/page.tsx

## Plain summary

People can narrow the Dashboard's file list by status, by part of a file name, and by a range of process dates, and every filter they set must match for a file to appear. Cancelled files are hidden by default; they can choose to see active files, cancelled files, or both. Active filters show on screen, one action clears them all, and the filters survive reload and the Back button.

## Technical summary

- **Filter form.** New `components/files/FileFilters.tsx`, following `TransactionFilters.tsx` (react-hook-form + zod, `mode: 'onBlur'`, `reValidateMode: 'onBlur'`):
  - **Status** select (Any / Uploaded / Processing / Completed / Failed) applies at once.
  - **Show** select (Active files / Cancelled files / Both) applies at once; `visibility=Active` is the default and omitted from the URL.
  - **File name** text: applied on Enter or after a 500 ms pause, not on every keystroke; trimmed; empty means no filter.
  - **Processed from / to** dates (`yyyy-MM-dd`), applied on submit. A new `lib/validation/fileFilters.ts` refuses a non-date and a From after To (message on From), checked on leave and on submit; no request is sent while invalid.
- **URL <-> API.** The URL holds `processedFrom` / `processedTo` as plain `yyyy-MM-dd`. The API query converts them to the start of the From day (`T00:00:00.000`) and the end of the To day (`T23:59:59.999`) in the browser's time zone, with the local offset (e.g. `+02:00`), URL-encoded (`%2B`). Changing any filter resets to page 1 and keeps the sort.
- **Active filters.** Removable chips (status in words, file name in quotes, date range, "Showing cancelled" / "Showing active and cancelled") + Clear all (new `lib/files/activeFilters.ts`, mirroring `lib/transactions/activeFilters.ts`).
- **No-match state.** When filters are active and no file matches: the active filters and a "Clear all filters" action. Never shown together with "No files yet".
- **Layout.** Inline at md+; below md a "Filters" button opening a full-width bottom Sheet (as the transactions list does).

## Acceptance criteria

- **AC-1** (coverage: playwright): Choosing a status, or typing part of a file name (any letter case), narrows the list to matching files; the filters combine, return to page 1, and survive reload and the browser Back button.
- **AC-2** (coverage: playwright): Choosing a process-date range narrows the list to files last processed within those whole days in the person's local time; files not processed yet are left out.
- **AC-3** (coverage: vitest): A From date after the To date, or a date that cannot be read, shows a problem on the field when leaving it or applying, stays until corrected, and the list is not changed.
- **AC-4** (coverage: playwright): Cancelled files are hidden by default; choosing "Cancelled files" shows only cancelled files and "Both" shows active and cancelled files together.
- **AC-5** (coverage: vitest): Each active filter appears as a removable label, "Clear all" removes them all, and when filters match no file the list says so with a clear action instead of "No files yet".
- **AC-6** (coverage: playwright): At 360px the filters open from a "Filters" button, work by keyboard alone, and the page has no horizontal scroll.

Additional technical checks (1):
- Process dates are sent as local start / end of day with the offset URL-encoded, and nothing is sent while the range is invalid (NFR-4).

## Manual test checklist

- Choose status "Completed" → only Completed files are listed and you are on page 1.
- Type part of a file name in lower case and pause → only files whose name contains it are listed; reload the page → the filter is still applied.
- Pick a From date later than the To date and apply → you see a problem on the From date and the list does not change.
- Pick a date range covering today and apply → only files processed today are listed.
- Change "Show" to "Both" → cancelled files appear and are marked Cancelled; change it back to "Active files" → they disappear.
- Click "Clear all" → every filter is removed and the full list returns.
- At phone width, open "Filters" → the filters appear in a panel from the bottom and can be applied.

## Resolved design choices (defaults chosen; stories approval delegated)

- Status and Show apply as soon as they are chosen; the file name applies on Enter or after a short pause; the date range applies with an Apply button, exactly like the transactions filters.
- The address bar keeps plain dates (`2026-04-15`); the app turns them into whole local days when asking the back-end.
- "Show" is a select with three choices (Active files, Cancelled files, Both) placed with the other filters; Active files is the default.
- Filters combine with each other and keep the current sort.

## Infrastructure reuse notes

- **Pattern.** Mirror `components/transactions/TransactionFilters.tsx`, `lib/transactions/activeFilters.ts`, and `lib/validation/transactionFilters.ts` for the file list. Extend story 1's `lib/files/listQuery.ts` (`withFilters`) rather than adding a second URL parser.
- **Primitives.** shadcn Select (with the synchronous type-ahead), Input, Label, Button, Sheet, Badge already exist.
- **Forms.** Required-field and validation conventions from `architecture.md` Conventions (on blur and submit, errors linked by `aria-describedby`).
- **E2E mock.** Extend `listFiles` in `app-frontend/e2e/fixtures/mock-backend.ts` to honour `status`, `fileName` (case-insensitive contains), `processedFrom` / `processedTo` (offset date-times; unprocessed files never match), and `visibility` (Active default / Cancelled / Both), and to return 400 for `processedFrom` later than `processedTo`.
