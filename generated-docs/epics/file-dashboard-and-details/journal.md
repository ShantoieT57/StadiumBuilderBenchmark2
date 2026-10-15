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

## Story 4: File details

- **What the screen shows.** Opening a file shows:
  - its summary: total rows, and how many were loaded, skipped or ignored
  - its transaction counts, each linking to that file's transactions
  - a "fully reviewed" note when nothing is left to review
  - the processing history, stage by stage
- **Back to the list.** "Back to dashboard" and the browser Back button both return to the list exactly as it was left.

## Story 5: File states and download

- **Download.** The file details screen can download the original file under its original name.
- **Failed files.** They show why they failed, with no retry.
- **Uploaded or processing files.** They say their transactions are not available yet.
- **Cancelled files.** They say when and by whom, and that the original was discarded.
- **Live refresh.** The screen refreshes on its own when the open file changes.
