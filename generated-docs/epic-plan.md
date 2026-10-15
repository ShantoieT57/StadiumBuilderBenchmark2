# Epic Plan — Transaction Import and Approval App

Every epic in this project, what it delivers, and what it builds on. Live status
(not started / in flight / done) is shown by `/status` and the dashboard.

> Plan only — edited during planning on `main`, never on an epic branch.

The .NET back-end (`app-backend/`, contract `app-backend/docs/TransactionApi.yaml`) was built
first and already implements every rule server-side. These epics build the Next.js front-end on
top of it.

## Epics

| # | Epic | Delivers | Builds on |
|---|---|---|---|
| 1 | Sign-in and app shell (`sign-in-and-app-shell`) | People sign in with their email and password, land on the right screen for their role, always see who is signed in, see only the menu items their role allows, and are signed out when idle, when they sign in elsewhere, or when they choose to. | — |
| 2 | Transactions list and search (`transactions-list`) | Both roles can browse, sort, page through and filter every transaction, and open one to see all its details — on a desktop and on a phone. | Sign-in and app shell (`sign-in-and-app-shell`) |
| 3 | File dashboard and file details (`file-dashboard-and-details`) | Both roles see every file with its status and review progress, can sort and filter the list, and can open a file to see its summary, processing history, why it failed, and download the original. | Sign-in and app shell (`sign-in-and-app-shell`), Transactions list and search (`transactions-list`) |
| 4 | File upload (`file-upload`) | Importers upload the daily transaction file, see its progress and a confirmation, are told clearly when a file is refused or is a duplicate, and watch processing finish without refreshing. | File dashboard and file details (`file-dashboard-and-details`) |
| 5 | Correcting and cancelling files (`file-correction-and-cancel`) | Importers fix the rows the app couldn't accept and have the file checked again — or cancel a file they can't fix. Cancelled files are hidden unless chosen. | File dashboard and file details (`file-dashboard-and-details`), File upload (`file-upload`) |
| 6 | Approving and rejecting transactions (`approve-and-reject`) | Approvers approve or reject each waiting transaction (a reason is required to reject), see the list update straight away, are told when someone else got there first, and see how many are still waiting on the menu. | Transactions list and search (`transactions-list`) |
| 7 | Exporting transactions (`transaction-export`) | Approvers download a spreadsheet-ready file of exactly the transactions their current filters show. Importers never see the export option. | Transactions list and search (`transactions-list`) |

## Coverage

Everything in the spec is assigned to an epic (IDs are the brief's own rule IDs):

| What you asked for | Epic |
|---|---|
| Sign in with email and password (SI-01) | Sign-in and app shell (`sign-in-and-app-shell`) |
| One message for a wrong email or password (SI-02) | Sign-in and app shell (`sign-in-and-app-shell`) |
| Connection problem shown differently from a wrong password (SI-03) | Sign-in and app shell (`sign-in-and-app-shell`) |
| Forgotten password tells you to contact your administrator (SI-04) | Sign-in and app shell (`sign-in-and-app-shell`) |
| Landing screen depends on role (SI-05) | Sign-in and app shell (`sign-in-and-app-shell`) |
| Signed out after 60 idle minutes (SI-06) | Sign-in and app shell (`sign-in-and-app-shell`) |
| Signed in in one place at a time (SI-07) | Sign-in and app shell (`sign-in-and-app-shell`) |
| Sign out ends every session (SI-08) | Sign-in and app shell (`sign-in-and-app-shell`) |
| Always shows who is signed in (SI-09) | Sign-in and app shell (`sign-in-and-app-shell`) |
| Disallowed items hidden, not disabled (AC-01) | Sign-in and app shell (`sign-in-and-app-shell`) |
| No-access message on a disallowed screen (AC-02) | Sign-in and app shell (`sign-in-and-app-shell`) |
| Role rules enforced by the app itself (AC-03) | Sign-in and app shell (`sign-in-and-app-shell`) |
| Everything works by keyboard (GN-02) | Sign-in and app shell (`sign-in-and-app-shell`) |
| Labels on icon-only buttons (GN-03) | Sign-in and app shell (`sign-in-and-app-shell`) |
| Required fields marked, checked on leave and submit (GN-04) | Sign-in and app shell (`sign-in-and-app-shell`) |
| Success messages fade, problems stay (GN-05) | Sign-in and app shell (`sign-in-and-app-shell`) |
| Transaction list columns (TL-01) | Transactions list and search (`transactions-list`) |
| Newest first, sort kept across pages (TL-02) | Transactions list and search (`transactions-list`) |
| Transaction page size (TL-03) | Transactions list and search (`transactions-list`) |
| Transaction details, read-only rejection reason (TL-06) | Transactions list and search (`transactions-list`) |
| Empty transactions list (TL-08) | Transactions list and search (`transactions-list`) |
| Transaction filters (SF-01) | Transactions list and search (`transactions-list`) |
| Filters combine (SF-02) | Transactions list and search (`transactions-list`) |
| Active filters shown, one action clears all (SF-03) | Transactions list and search (`transactions-list`) |
| No-match state (SF-04) | Transactions list and search (`transactions-list`) |
| Transactions start as Imported (TS-01) | Transactions list and search (`transactions-list`) |
| Loaded transactions are created by "System" (FP-08) | Transactions list and search (`transactions-list`) |
| Works on a phone, row actions stay available (GN-01) | Transactions list and search (`transactions-list`) |
| Status and transaction counts above the file list (DB-01) | File dashboard and file details (`file-dashboard-and-details`) |
| File list columns (DB-02) | File dashboard and file details (`file-dashboard-and-details`) |
| Newest first, sort by any column (DB-03) | File dashboard and file details (`file-dashboard-and-details`) |
| File page size (DB-04) | File dashboard and file details (`file-dashboard-and-details`) |
| Filter files (DB-05) | File dashboard and file details (`file-dashboard-and-details`) |
| Active / cancelled / both (DB-06) | File dashboard and file details (`file-dashboard-and-details`) |
| Open a file's details (DB-07) | File dashboard and file details (`file-dashboard-and-details`) |
| Empty dashboard (DB-09) | File dashboard and file details (`file-dashboard-and-details`) |
| File summary counts (FD-01) | File dashboard and file details (`file-dashboard-and-details`) |
| Counts open the filtered transactions list (FD-02) | File dashboard and file details (`file-dashboard-and-details`) |
| Fully reviewed indicator (FD-03) | File dashboard and file details (`file-dashboard-and-details`) |
| Processing history (FD-04) | File dashboard and file details (`file-dashboard-and-details`) |
| Download the original file (FD-05) | File dashboard and file details (`file-dashboard-and-details`) |
| Failed file shows its reason (FD-06) | File dashboard and file details (`file-dashboard-and-details`) |
| Not-yet-available message while processing (FD-07) | File dashboard and file details (`file-dashboard-and-details`) |
| Status shown in words, not colour alone (FS-03) | File dashboard and file details (`file-dashboard-and-details`) |
| Existing references are skipped (FP-05) | File dashboard and file details (`file-dashboard-and-details`) |
| Loaded, skipped and ignored counts add up (FP-07) | File dashboard and file details (`file-dashboard-and-details`) |
| Drag a file in or choose one (UP-01) | File upload (`file-upload`) |
| File kind preselected as Bank transactions (UP-02) | File upload (`file-upload`) |
| Only CSV files accepted (UP-03) | File upload (`file-upload`) |
| File name checks (UP-04) | File upload (`file-upload`) |
| Upload progress and success message (UP-05) | File upload (`file-upload`) |
| Retry after a failed upload (UP-06) | File upload (`file-upload`) |
| Processing progress updates without refreshing (UP-07) | File upload (`file-upload`) |
| Duplicate file detection (FP-01) | File upload (`file-upload`) |
| Duplicate message names the earlier file (FP-02) | File upload (`file-upload`) |
| Correction screen lists only invalid rows (FC-01) | Correcting and cancelling files (`file-correction-and-cancel`) |
| Edit invalid rows and check again (FC-02) | Correcting and cancelling files (`file-correction-and-cancel`) |
| Recheck result (FC-03) | Correcting and cancelling files (`file-correction-and-cancel`) |
| Cancel if it can't be corrected (FC-04) | Correcting and cancelling files (`file-correction-and-cancel`) |
| Cancel asks for confirmation, keeping the file is the default (FX-01) | Correcting and cancelling files (`file-correction-and-cancel`) |
| Can't cancel a file with approved transactions (FX-02) | Correcting and cancelling files (`file-correction-and-cancel`) |
| Cancelling removes the file's transactions (FX-03) | Correcting and cancelling files (`file-correction-and-cancel`) |
| Cancelling discards the original file (FX-04) | Correcting and cancelling files (`file-correction-and-cancel`) |
| Cancelled files hidden unless chosen (FX-05) | Correcting and cancelling files (`file-correction-and-cancel`) |
| Cancelling an already-cancelled file (FX-06) | Correcting and cancelling files (`file-correction-and-cancel`) |
| Duplicate failures can't be retried (FS-01) | Correcting and cancelling files (`file-correction-and-cancel`) |
| Files with invalid rows can be corrected (FS-02) | Correcting and cancelling files (`file-correction-and-cancel`) |
| Row rules decide which rows are invalid (FP-03) | Correcting and cancelling files (`file-correction-and-cancel`) |
| Every failure reason shown on a row (FP-04) | Correcting and cancelling files (`file-correction-and-cancel`) |
| A file loads all or nothing (FP-06) | Correcting and cancelling files (`file-correction-and-cancel`) |
| Shortcut to correction from the list, importer (DB-08) | Correcting and cancelling files (`file-correction-and-cancel`) |
| Cancel action, importer (FD-08) | Correcting and cancelling files (`file-correction-and-cancel`) |
| Approve/Reject only on Imported, approver (TL-04) | Approving and rejecting transactions (`approve-and-reject`) |
| Imported count on the Transactions menu, approver (TL-07) | Approving and rejecting transactions (`approve-and-reject`) |
| Only Imported can be approved or rejected (TS-02) | Approving and rejecting transactions (`approve-and-reject`) |
| Approved and Rejected are final (TS-03) | Approving and rejecting transactions (`approve-and-reject`) |
| Final status enforced by the app, not just hidden buttons (TS-04) | Approving and rejecting transactions (`approve-and-reject`) |
| Approve asks for confirmation, Cancel is the default (AP-01) | Approving and rejecting transactions (`approve-and-reject`) |
| Approval updates the list straight away (AP-02) | Approving and rejecting transactions (`approve-and-reject`) |
| Records who approved and when (AP-03) | Approving and rejecting transactions (`approve-and-reject`) |
| Someone else got there first, approve (AP-04) | Approving and rejecting transactions (`approve-and-reject`) |
| Rejection reason is required (RJ-01) | Approving and rejecting transactions (`approve-and-reject`) |
| 500-character limit with a remaining count (RJ-02) | Approving and rejecting transactions (`approve-and-reject`) |
| Rejection updates the list straight away (RJ-03) | Approving and rejecting transactions (`approve-and-reject`) |
| Records who rejected and when (RJ-04) | Approving and rejecting transactions (`approve-and-reject`) |
| Someone else got there first, reject (RJ-05) | Approving and rejecting transactions (`approve-and-reject`) |
| Importer never sees Approve, Reject or Export (TL-05) | Exporting transactions (`transaction-export`) |
| Export matches current filters across all pages (EX-01) | Exporting transactions (`transaction-export`) |
| No filters exports everything (EX-02) | Exporting transactions (`transaction-export`) |
| Export columns (EX-03) | Exporting transactions (`transaction-export`) |
| Export file name describes date and filters (EX-04) | Exporting transactions (`transaction-export`) |
| Export unavailable when nothing matches (EX-05) | Exporting transactions (`transaction-export`) |
| Export opens cleanly in a spreadsheet (EX-06) | Exporting transactions (`transaction-export`) |

_93 requirements, all assigned._
