# Journal — file-correction-and-cancel

# Journal — Correcting and cancelling files

## Story 1: Correct invalid rows and check again

- **Who sees the link.** The file details page looks up who is signed in on the server, so only Importers see "Correct invalid rows".
- **The correction screen.** It has its own Importer-only entry in the access map, kept out of the menu. Saved links to it are still role-checked.
- **Checking again.** "Check again" refuses to send only when a row the Importer changed breaks a rule. Rows left untouched never block the check.

## Story 2: Correction shortcut and who can correct

- **Dashboard shortcut.** The Dashboard shows a "Correct" shortcut to Importers, only on files waiting for corrections.
- **Not waiting any more.** If the file stops waiting, the correction screen shows a plain notice with its status and a link to its details.
- **Live updates.** They refresh the rows without wiping edits that haven't been sent yet.

## Story 3: Cancel a file

- **Where to cancel.** Importers can cancel a file from its details page or from the correction screen.
- **Confirmation.** It names the file and has "Keep file" as the default.
- **After cancelling.** The details show who cancelled the file and when, straight away.

## Manual test — 2026-10-15

- **Who ran it.** Claude, against the real back-end. The user delegated this approval.
- **Result.** 23/23 passed. This includes:
  - correcting a real file in two steps until it loaded
  - a refused cancel (the file had approved transactions)
  - an allowed cancel
