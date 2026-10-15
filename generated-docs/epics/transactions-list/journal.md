# Journal — Transactions list and search

## Story 1: Transactions list with sorting, paging and phone layout

- **The list replaces the placeholder.** The Transactions page is now a real list.
- **Address bar.** Sort, page and page size are kept in the address bar using the back-end's own names (e.g. `sortBy=Amount&sortDirection=Desc`). The defaults are left out, so a plain /transactions shows newest first, 20 per page.
- **Ready for filters.** The URL reader already accepts the filter parameters (status, fileId, dates, amounts, search), so the filter story and incoming dashboard links can plug straight in.
- **shadcn `cn` again.** Adding the shadcn table, select and badge again pulled in the stray `cn` npm package and bad imports. Both were fixed (see template-feedback).

## Story 2: Filter and search transactions

- **File picker.** The filter panel loads the 50 most recently processed files for the File picker, because the back-end's largest page size is 50. If a link points at an older file, the filter still works: the picker and the chip show "Selected file" in place of its name.
- **No-match message.** It lists the filters in use under "Filters in use", separately from the "Active filters" chips, so the chips aren't counted twice.

## Story 3: Transaction details

- **Details address.** Opening a transaction goes to a plain /transactions/<id> address. The list's filters, sort and page are not put in that address; the app remembers them for the browser tab instead, which keeps the details address clean. "Back to transactions" and the browser Back button both return to the list exactly as it was left.
- **Times on the details screen.** "Created on" and "Last changed on" are shown in local time. The transaction date itself is still shown exactly as the bank file had it.
