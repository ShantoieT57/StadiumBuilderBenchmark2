# Journal — file-upload

## Story 1: Upload a file with progress and confirmation

- **The Upload screen.** It is no longer a placeholder. Importers can:
  - drag a file onto it, or choose one with the keyboard
  - see the file's name and size, with a Remove button
  - keep "Bank transactions" as the preselected kind
  - upload with a progress bar and a percentage
  - then see the shared success message, and a "Last upload" box linking to the file's details and the dashboard
- **Upload requests.** Uploads use their own small request helper so they can report progress. It still goes through the app's own /api address and fails the same way as every other call.
