# Journal — file-correction-and-cancel

# Journal — Correcting and cancelling files

## Story 1: Correct invalid rows and check again

- **Who sees the link.** The file details page looks up who is signed in on the server, so only Importers see "Correct invalid rows".
- **The correction screen.** It has its own Importer-only entry in the access map, kept out of the menu. Saved links to it are still role-checked.
- **Checking again.** "Check again" refuses to send only when a row the Importer changed breaks a rule. Rows left untouched never block the check.
