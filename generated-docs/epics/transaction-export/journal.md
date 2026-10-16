# Journal — transaction-export

## Story 1 — Export the filtered transactions

Export (Approvers only; right-aligned on wide screens, full width on phones) downloads the CSV for the filters and sort on screen across every page — paging is never sent. The file is saved unchanged under the server's Content-Disposition name (filename* first, falling back to transactions.csv). "Exporting…" while busy, then a self-closing "Export downloaded" naming the file. To read the name, apiClient gained an opt-in `withResponseHeaders`; errors and 401 handling stay central. `saveBlob` moved out of FileDetailsView into `lib/download/saveBlob.ts`.

## Story 2 — Nothing to export, and export problems

With nothing to export the button stays focusable but aria-disabled, with a note beside it in the server's wording. Problems appear inline beside Export (never as toasts) and replace the note, so only one message shows at a time. A stale 409 also reloads the list so Export stays unavailable until a filter changes; network/5xx get "Try again" repeating the exact query; 403/400 show the server's words without retry; an ended session goes to sign-in leaving nothing behind. The problem resets when the filters change, not on sort or paging.
