# Story 1: Correct invalid rows and check the file again

- **Epic:** file-correction-and-cancel
- **Slug:** story-1-correct-and-check-again
- **Roles:** Importer
- **Route:** /dashboard/files/[fileId]/corrections
- **Page action:** create_new
- **Infrastructure only:** false
- **Requirement IDs:** R1, R2, R3, R12, R13, R14, R15, BR1, BR7, BR8, BR10, BR11, NFR-1, NFR-2, NFR-3, NFR-4
- **Target file:** app-frontend/src/app/(authenticated)/dashboard/files/[fileId]/corrections/page.tsx

## Plain summary

On the details of a file that failed because of invalid rows, the Importer selects "Correct invalid rows" and gets a correction screen listing only the rows that failed, each with every value from the file and every reason it failed. They fix the values, can save their changes, and select "Check again": if every row now passes the file loads and becomes Completed; if not, the file stays Failed and the screen shows just the rows that still fail and how many remain.

## Technical summary

- **Page.** New `(authenticated)/dashboard/files/[fileId]/corrections/page.tsx`, wrapped in `RouteGuard` with a new Importer-only, not-in-menu access row (see reuse notes), rendering no `<main>`. Client component `components/files/CorrectionsView.tsx`, keyed by `fileId`. Loads `getFile(fileId)` (header: file name, `FileStatusBadge`, "Back to file details" link via `fileDetailsHref`) and `getInvalidRows(fileId)`.
- **Entry from details.** In `FileDetailsView`'s reserved `data-slot="file-actions"` area: a "Correct invalid rows" link for an Importer only, when `status === 'Failed' && failureKind === 'InvalidRows' && !isCancelled` (hidden otherwise, never disabled; AC-01). `FileDetailsView` needs the signed-in role: pass `role` from the page (as `FilesList` does).
- **Invalid rows list (R1, R14).** Heading "Invalid rows" with "<N> rows still need correcting" (`totalCount`). Each row is a card (`<section aria-labelledby>`) titled "Row <rowNumber>", with the reasons as a list in words (problem token, not colour alone) and seven labelled inputs: Reference, Transaction date, Account number, Description, Amount, Transaction type, Currency, pre-filled with the values exactly as in the file. Grid of fields at md+, a single column below md (NFR-1); no horizontal page scroll at 360px.
- **Form (BR7).** One react-hook-form + zod form over all rows (`mode: 'onBlur'`, `reValidateMode: 'onBlur'`), schema in `lib/validation/corrections.ts`. Required (`required` + `*`): Transaction date, Account number, Amount, Transaction type. Rules mirror the row rules with the back-end reason wording: type `C` or `D` ("Invalid Transaction Type"); date readable as a date and time ("Invalid Transaction Date"); amount a number, not negative, at most two decimals ("Invalid Amount"); account number not empty after trim ("Missing Account Number"); reference not repeated among the listed rows ignoring case, empty references excepted ("Duplicate Reference In File"). Errors under the field, linked by `aria-describedby`. The back-end stays authoritative.
- **Save changes (workflow 2).** Secondary "Save changes" button -> `saveCorrections(fileId, { rows })` with only the changed rows, each with `id` + all seven fields as strings. The button is never disabled: with nothing changed it says "No changes to save." Success toast "Changes saved." (auto-dismisses); the returned list replaces the form values (reasons stay from the last check).
- **Check again (R2, R3, BR8).** Primary "Check again" -> `recheckFile(fileId, { corrections })` with the changed rows (empty array allowed). `status === 'Completed'`: success toast "<file name> has been checked again and loaded." and `router.push(fileDetailsHref(fileId))`. Still `Failed`: reset the form to `result.invalidRows` (only the rows still failing, all reasons, new count) and announce "<N> rows still need correcting" in a `role=status` region; focus moves to the "Invalid rows" heading.
- **Server refusals.** 400 ValidationProblem keys `corrections[i].field` / `rows[i].field` map back to the i-th sent row's field via `setError` (shown under it); `$` / unmapped keys show in one inline `role=alert` above the actions. 409 is handled by story 2 (not-waiting state).
- **Pending and failures (NFR-3).** While a request runs, both actions are locked and the pressed one shows "Saving…" / "Checking…"; network or other failures show an error toast with the message and a "Try again" action that resends the same request; the edits stay in the form. Return early on `isRedirectingToSignIn`.
- **Privacy (NFR-4).** Never log row values, the request body or error bodies that echo them; no row data in thrown error messages.

## Acceptance criteria

- **AC-1** (coverage: vitest): For an Importer, the details of a file that failed because of invalid rows offer "Correct invalid rows", whose screen lists only the invalid rows, each with its row number, all seven values from the file in labelled fields (required ones marked) and every reason it failed, plus how many invalid rows remain.
- **AC-2** (coverage: vitest): Each field is checked when the Importer leaves it and again on "Check again", following the row rules (type C or D, readable date and time, amount not negative with at most two decimals, account number filled in, reference not repeated among the listed rows ignoring case), with the problem shown under that field.
- **AC-3** (coverage: playwright): Correcting every invalid row and selecting "Check again" loads the file: a self-closing message confirms it and the Importer lands on the file's details showing Completed with its transactions.
- **AC-4** (coverage: playwright): When some rows still fail after "Check again", the file stays Failed and the screen shows only the rows that still fail, with all their reasons and the new count; a value the server refuses is shown under the matching row's field.
- **AC-5** (coverage: playwright): "Save changes" keeps the edits without checking the file again, so reopening the correction screen shows the saved values with the reasons from the last check.
- **AC-6** (coverage: vitest): While saving or checking again the actions show progress and cannot be pressed twice; if the request fails a problem message with "Try again" appears and the edits are kept.

Additional technical checks (3):
- Requests send only changed rows, each with its id and all seven values as text (an empty value as an empty string); "Check again" with no changes sends an empty list.
- Server field problems keyed like `corrections[0].amount` land under the matching row's field; whole-request problems show above the actions.
- Row values (account numbers, descriptions) never appear in browser logs or error messages (NFR-4).

## Manual test checklist

- Make a copy of `documentation/TestFiles/transactions_2026-04-15.csv` with new references, set one row's type to `X` and blank another row's account number, and upload it as the Importer → its details show Failed and offer "Correct invalid rows".
- Select "Correct invalid rows" → you see only the two bad rows, each with all its values and the reasons ("Invalid Transaction Type", "Missing Account Number") and "2 rows still need correcting".
- Type `-5` in an Amount field and tab away → the problem shows under that field straight away, not while you type.
- Fix one row only and select "Check again" → the file stays Failed and the screen now shows 1 row still needing correction.
- Change a value, select "Save changes", leave and reopen the correction screen → your saved value is still there.
- Fix the last row and select "Check again" → a message confirms the file loaded, it disappears after a few seconds, and you are on the file's details showing Completed.
- Narrow the browser to phone width → each row's fields stack and the screen has no sideways scrolling; everything works by keyboard alone.

## Resolved design choices (defaults chosen; stories approval delegated)

- Corrections happen on their own screen (`/dashboard/files/<id>/corrections`), opened from the file's details, rather than inline on the details screen: the details stay read-only for both roles, and the correction screen has a link of its own for the dashboard shortcut and for saved links.
- Each invalid row is an editable card ("Row 4", its reasons, then its seven fields) rather than a wide table of inputs, so it works on a phone without sideways scrolling.
- A separate "Save changes" action is offered alongside "Check again", so the Importer can keep partial work without triggering a check; "Check again" is the main action.
- Only the rows the Importer changed are sent; "Check again" with nothing changed checks the file again with the values already saved.
- The duplicate-reference check in the browser can only compare the invalid rows shown; clashes with the file's valid rows are left to the server, whose answer is shown under the field.
- After a check that loads the file, the Importer is taken to the file's details (the correction screen has nothing left to show).

## Infrastructure reuse notes

- **Endpoints.** `getInvalidRows`, `saveCorrections`, `recheckFile`, `getFile` in `lib/api/endpoints.ts`; types `InvalidRowList`, `InvalidRow`, `RowCorrection`, `RecheckResult`, `FileDetails` in `src/types/api-generated.ts`. Proxy allowlist (`BACKEND_ENDPOINTS`) already has GET/PATCH invalid-rows and POST recheck.
- **Access.** Add an Importer-only row to `ROUTE_ACCESS` for the correction screen, kept out of the menu (e.g. an `inMenu: false` flag that `menuItemsFor` filters out); extend `AppRoute`. `RouteGuard` + `NoAccess` then cover saved links (story 2 tests it).
- **Details.** `FileDetailsView` reserved `data-slot="file-actions"` header area; `fileDetailsHref` from `components/files/FilesList.tsx`; `FileStatusBadge`.
- **Forms.** react-hook-form `mode: 'onBlur'` + zod, required `*`, `aria-describedby`; shadcn Input, Label, Button, Card (add with the shadcn CLI if missing).
- **Feedback.** `useToast()` success / error; `isNetworkError` / `isRedirectingToSignIn` / `statusOf` from `lib/api/errors.ts`; `APIError.errors` for ValidationProblem keys.
- **E2E mock.** Extend `app-frontend/e2e/fixtures/mock-backend.ts` with real semantics: a seeded Failed (InvalidRows) file with invalid rows; GET invalid-rows (Importer only, 403 for Approver, 409 `{message: "This file is not waiting for corrections."}` unless Failed + InvalidRows + not cancelled); PATCH invalid-rows (saves values, keeps reasons); POST recheck (applies corrections, re-runs the row rules over the kept rows, Completed when none fail -> discards the kept rows so invalid-rows answers 409, else Failed with the remaining rows and count); 400 ValidationProblem for an unknown row id. Emit `file-changed` after each change.
