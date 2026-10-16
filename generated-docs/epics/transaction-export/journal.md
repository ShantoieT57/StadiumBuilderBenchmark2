# Journal — transaction-export

## Story 1 — Export the filtered transactions

Export (Approvers only; right-aligned on wide screens, full width on phones) downloads the CSV for the filters and sort on screen across every page — paging is never sent. The file is saved unchanged under the server's Content-Disposition name (filename* first, falling back to transactions.csv). "Exporting…" while busy, then a self-closing "Export downloaded" naming the file. To read the name, apiClient gained an opt-in `withResponseHeaders`; errors and 401 handling stay central. `saveBlob` moved out of FileDetailsView into `lib/download/saveBlob.ts`.
