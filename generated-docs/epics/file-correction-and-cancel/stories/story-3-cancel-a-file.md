# Story 3: Cancel a file

- **Epic:** file-correction-and-cancel
- **Slug:** story-3-cancel-a-file
- **Roles:** Importer, Approver
- **Route:** /dashboard/files/[fileId]
- **Page action:** modify_existing
- **Infrastructure only:** false
- **Requirement IDs:** R4, R5, R6, R7, R8, R9, R10, R17, BR2, BR3, BR4, BR5, BR9, BR10, BR11, NFR-2, NFR-3, NFR-4, NFR-5
- **Target file:** app-frontend/src/app/(authenticated)/dashboard/files/[fileId]/page.tsx

## Plain summary

On a file's details, and on the correction screen of a file they cannot fix, the Importer selects "Cancel file". A confirmation names the file, with "Keep file" as the default choice. Once confirmed, the file shows as cancelled (by whom and when), its transactions and original file are gone, and it drops out of the Dashboard's active list until someone chooses to show cancelled files. A file with approved transactions cannot be cancelled and the app explains why; a file someone else already cancelled simply shows as cancelled.

## Technical summary

- **Action (R17, BR2).** In `FileDetailsView`'s `data-slot="file-actions"`: a "Cancel file" button (outline, destructive token) for an Importer when `!isCancelled`, any status; hidden for Approvers and for cancelled files. Also on the story-1 correction screen header (FC-04). One shared `components/files/CancelFileDialog.tsx`.
- **Confirmation (R5, BR3).** shadcn AlertDialog (`npx shadcn add alert-dialog --yes`): title "Cancel <file name>?", body: its transactions will be removed, the original file can no longer be downloaded, and it will be hidden from the Dashboard unless cancelled files are shown. Buttons "Keep file" (initial focus via `onOpenAutoFocus`) and "Cancel file". Escape / Keep file close with nothing sent; focus returns to the trigger.
- **Cancel (R7, R8, BR9, BR10).** `cancelFile(fileId)`; while pending, "Cancelling…" with both buttons locked (NFR-3). On 200: close, success toast "<file name> has been cancelled." (auto-dismisses), and the details render the returned `FileDetails` at once (cancelled badge + "Cancelled on <local> by <name>" notice, transaction counts zero, no Download original since `canDownload` is false, no Cancel / Correct actions). From the correction screen, go to the file's details. The `file-changed` event keeps other open screens current (NFR-5).
- **Already cancelled (R10, BR5).** The idempotent 200 is the same success path; the details show the original cancel time and person, no problem message.
- **Refused (R6, BR4).** On 409: close the dialog and show an error toast titled "Problem" with the back-end's message verbatim ("This file cannot be cancelled because N of its transactions has/have been approved."), which persists until dismissed; the file stays as it was (refetched).
- **Other failures.** Network / other statuses: the dialog stays open with an inline `role=alert` problem and "Try again"; return early on `isRedirectingToSignIn`. 403 shows the server's message.
- **Dashboard (R9, BR9).** No new code: the default Active view omits cancelled files and the Show control (Cancelled / Both) reveals them with the Cancelled badge; the list refetches on `file-changed`.
- **Privacy (NFR-4).** Messages name only the file.

## Acceptance criteria

- **AC-1** (coverage: vitest): An Importer sees "Cancel file" on the details of any file that is not cancelled (and on its correction screen); it is not shown to Approvers or on a cancelled file.
- **AC-2** (coverage: playwright): Selecting "Cancel file" asks for confirmation naming the file with "Keep file" focused; choosing "Keep file" or pressing Escape closes it with the file unchanged, all by keyboard.
- **AC-3** (coverage: playwright): Confirming cancels the file: a self-closing message confirms it, the details show it cancelled with who and when, its transaction counts drop to zero, and the original can no longer be downloaded.
- **AC-4** (coverage: playwright): After cancelling, the file is gone from the Dashboard's default list and appears, marked Cancelled, when the person chooses to show cancelled files.
- **AC-5** (coverage: playwright): Cancelling a file with approved transactions is refused with the server's explanation, which stays on screen until dismissed, and the file stays active.
- **AC-6** (coverage: vitest): Cancelling a file that someone else already cancelled shows it as cancelled with no problem message; while a cancel is in progress it shows progress and cannot be confirmed twice, and a failed request shows a problem with "Try again".

Additional technical checks (2):
- The confirm sends one `POST /files/{id}/cancel` with no body through the same-origin `/api`; "Keep file" sends nothing.
- The success and problem messages name only the file, never row values (NFR-4).

## Manual test checklist

- As the Importer, open a Completed file's details and select "Cancel file" → a confirmation names the file and "Keep file" is highlighted; press Enter → it closes and nothing changes.
- Select "Cancel file" again and confirm → a message says it was cancelled and fades; the details show "Cancelled on … by File Importer", zero transactions and no Download original.
- Go to the Dashboard → the file is not listed; set Show to "Cancelled files" → it appears marked Cancelled.
- As the Approver, approve one transaction of another file; as the Importer, try to cancel that file → you see why it cannot be cancelled, the message stays until you close it, and the file is unchanged.
- Open the same file's details in two tabs as the Importer, cancel it in one, then cancel it in the other → it simply shows as cancelled, with no error.
- On a file waiting for corrections, cancel it from the correction screen → you land on its details showing it cancelled.
- Sign in as the Approver → no "Cancel file" on any file's details.

## Resolved design choices (defaults chosen; stories approval delegated)

- "Cancel file" is offered on every file that is not cancelled (any status), since the back-end allows it; the refusal for approved transactions comes from the server and is shown as its explanation.
- The confirmation is a dialog whose default (focused) button is "Keep file", and it states the consequences (transactions removed, original discarded, hidden from the Dashboard).
- A refusal closes the dialog and shows a persistent problem message, so the explanation stays visible on the details; a connection failure keeps the dialog open with "Try again".
- Cancelling a file someone else already cancelled is shown with the same confirmation as a normal cancel; the details then show the original person and time.
- Cancelling from the correction screen takes the Importer to the file's details.

## Infrastructure reuse notes

- **Endpoint.** `cancelFile(fileId)` in `lib/api/endpoints.ts` returning `FileDetails`; the proxy allowlist already has POST cancel.
- **Details.** `FileDetailsView` already renders the cancelled badge, the "Cancelled on … by …" notice, zero counts and hides Download when `canDownload` is false; feed it the returned details instead of waiting for the event. Needs the `role` prop added in story 1.
- **Feedback.** `useToast()` success and error ("Problem", persists); `statusOf` / `isNetworkError` / `isRedirectingToSignIn`; `APIError.body` / `message` for the 409 text.
- **Primitives.** New shadcn AlertDialog; Button.
- **Dashboard.** `FilesList` + `FileFilters` Show control (Active / Cancelled / Both), `FileCancelledBadge`.
- **E2E mock.** POST /files/{id}/cancel with real semantics: Importer only (403 for Approver); 409 `{message}` with the count wording when the file has approved transactions; otherwise mark cancelled with time and person (idempotent: keep the first), remove its transactions, `canDownload: false`, content 410, invalid-rows 409, excluded from Active lists and the summary, emit `file-changed`; return `FileDetails`.
