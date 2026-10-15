# Journal — file-upload

## Story 1: Upload a file with progress and confirmation

- **The Upload screen.** It is no longer a placeholder. Importers can:
  - drag a file onto it, or choose one with the keyboard
  - see the file's name and size, with a Remove button
  - keep "Bank transactions" as the preselected kind
  - upload with a progress bar and a percentage
  - then see the shared success message, and a "Last upload" box linking to the file's details and the dashboard
- **Upload requests.** Uploads use their own small request helper so they can report progress. It still goes through the app's own /api address and fails the same way as every other call.

## Story 2: Refused files and failed uploads

- **Refused on the spot.** The Upload screen refuses a file straight away when it can tell the server would refuse it: several files dropped at once, a file that isn't a .csv, or a badly formed name.
  - It uses the server's exact wording, clears the refused file and sends nothing.
- **Refused by the server.** The server's message is shown word for word under the file field. It stays until another file is chosen.
- **Connection drop.** The file is kept and a "Try again" button sends it again.

## Manual test — 2026-10-15

- **Who ran it.** Claude, against the real back-end. The user delegated this approval.
- **Result.** 16/16 passed. This includes:
  - the over-10 MB message coming through the proxy
  - a smooth 0→100 progress bar under network throttling
  - live status changes after an upload
