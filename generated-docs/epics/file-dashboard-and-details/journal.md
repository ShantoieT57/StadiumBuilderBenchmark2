# Journal — file-dashboard-and-details

## Story 1: Dashboard file list with sorting, paging and phone layout

- **The real file list.** The Dashboard now shows the real file list in place of the placeholder. It works like the transactions list:
  - sort, page and page size live in the address bar
  - newest-processed files come first, 20 per page
  - on a phone each file becomes a compact card
  - the list refreshes itself when files or transactions change
- **Ready for filters.** The filters (status, name, processed dates, show cancelled) are already read from the address bar.

## Story 2: Filter the file list and show cancelled files

- **Dashboard filters.** The Dashboard has filters beside the file list: status, part of a file name, a process-date range, and a Show choice (active, cancelled or both).
  - They follow the same pattern as the transactions filters and are kept in the address bar.
  - They show as removable labels, with a Clear all.
- **No match.** When no file matches, the list says so and offers to clear the filters.

## Story 3: Dashboard status and transaction counts

- **Counts above the list.** The Dashboard shows file counts per status, and Imported / Approved / Rejected transaction counts, above the list.
  - A file count filters the list.
  - A transaction count opens the transactions list filtered to that status.
  - The counts load independently, so a problem with them never blocks the file list.
