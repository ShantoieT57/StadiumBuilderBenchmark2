# Story 2: Filter and search transactions

- **Epic:** transactions-list
- **Slug:** story-2-filter-and-search
- **Roles:** Importer, Approver
- **Route:** /transactions
- **Page action:** modify_existing
- **Infrastructure only:** false
- **Requirement IDs:** R6, R7, R8, R9, BR2, BR3, BR4, BR9, BR10, NFR-1, NFR-3, NFR-4
- **Target file:** app-frontend/src/app/(authenticated)/transactions/page.tsx

## Plain summary

People can narrow the list by status, file, a date range, an amount range, and text that matches the reference or account number. Every active filter shows on screen, one action clears them all, and links from the dashboard or file details open the list already filtered.

## Technical summary

- **Filter panel.** Inline on desktop, a Sheet on narrow screens.
- **Controls.**
  - status
  - file, with options from `getFiles`
  - `dateFrom` / `dateTo`, sent as `yyyy-MM-dd`
  - `minAmount` / `maxAmount`
  - `search`, applied on submit or after a short pause, not on every keystroke
- **URL state.** All filters live in the URL alongside sort and page, so incoming `?status=` and `?fileId=` links work. Changing a filter resets to page 1 and keeps the sort.
- **Active filters.** Each renders as a removable chip, plus a Clear all action.
- **Range validation.** Range fields are checked on blur and on submit: min above max, or start after end. Messages appear on the field, and no query is sent while a range is invalid.
- **No-match state.** `hasAnyTransactions=true` with zero items shows the no-match state with the active filters and a clear action. It never appears together with "No transactions yet".

## Acceptance criteria

- **AC-1** (coverage: playwright): Setting status, file, date range, amount range and search text (reference or account number) narrows the list to transactions matching every active filter, returns to page 1, keeps the sort, and search does not run on every keystroke.
- **AC-2** (coverage: playwright): Each active filter shows as a removable chip. Removing one chip drops only that filter, and one Clear all action removes them all.
- **AC-3** (coverage: playwright): Opening the list from a link carrying status and/or file shows the list already filtered with those filters shown as active, and reload or Back restores the same filtered view.
- **AC-4** (coverage: vitest): When filters match nothing, the list says no transactions match, shows the active filters, and offers to clear them, without showing "No transactions yet".
- **AC-5** (coverage: vitest): A minimum amount above the maximum, or a start date after the end date, shows a message on that field and the list is not filtered by the invalid range.
- **AC-6** (coverage: playwright): On a 360px-wide screen the filters are reachable and usable without horizontal scrolling, and every filter control works by keyboard alone.

Additional technical checks (1): search is debounced or submit-driven, never one request per keystroke.

## Manual test checklist

- Filter by status Imported and pick one file → only Imported transactions from that file remain, and you are on page 1.
- Type part of a reference in search → the list narrows after you pause or press Enter, not on every letter.
- Check the filters → each one shows as a chip. Remove one chip → only that filter goes. Click Clear all → the full list returns.
- Set a minimum amount higher than the maximum, then leave the field → you see a message on the field explaining the problem.
- Filter so nothing matches → you see "no transactions match" with your active filters and a button to clear them.
- Open /transactions?status=Rejected in the address bar → the list opens showing only Rejected transactions with a Rejected chip.
- At phone width, open the filters → they fit the screen with no sideways scrolling.

## Resolved design choices

- Filters sit beside the list on desktop and in a slide-out panel (Sheet) on phones.
- Filters, sort and page live in the address bar.

## Back-end behaviour already verified

See story 1. In short:
- dates are `yyyy-MM-dd`, inclusive of the whole day, with no offset;
- search is a case-insensitive literal substring over reference OR account;
- min and max are inclusive, non-negative decimals;
- a range with start after end gets a 400 on `dateTo` / `maxAmount`.

## Infrastructure reuse notes

- **Forms.** Use react-hook-form with `mode 'onBlur'` and `reValidateMode 'onBlur'`, and zod for the range checks. Link field errors to their input with `aria-describedby`. The sign-in form follows the same convention.
- **Phone panel.** Use the existing shadcn Sheet. Icon-only buttons (remove chip, filter toggle) need an aria-label plus a Tooltip.
- **File options.** `getFiles` is paged with page sizes 5, 10, 20 or 50. For the file filter, request the largest page (50, sorted by most recent) and note the limitation. Alternatively, show the selected file's name from `fileId` when it isn't in the options.
- **Everything else.** See story 1.
