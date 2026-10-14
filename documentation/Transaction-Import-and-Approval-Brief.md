# Transaction Import and Approval App

## What you are building

Build an app for a bank operations team that receives a file of bank transactions every day and has to decide on each transaction in it.

Two kinds of people use the app. An **importer** brings the transaction files into the app. An **approver** reviews every transaction from those files and either approves or rejects it. Every transaction ends up approved or rejected, and every rejection carries a written reason.

The app has to:

1. Let people sign in and show each person only what their role allows.
2. Take in transaction files, check them, and turn their rows into transactions.
3. Hold back a file that has problems until the importer corrects it or cancels it.
4. Give approvers a searchable list of transactions to approve, reject, and export.
5. Show, per file, how far the review has got.

Each rule below has an ID so you can refer to it when you test the app.

---

## Who uses the app

| Role | What they do | What they cannot do |
|---|---|---|
| **Importer** | Upload files, follow their progress, correct rows the app could not accept, cancel files, view transactions and file summaries. | Approve, reject, or export transactions. |
| **Approver** | View files and transactions, approve and reject transactions, export transactions. | Upload, correct, or cancel files. |

Set the app up with these two people so it can be tried straight away. Both use the password `Test123`.

| Name | Email | Role |
|---|---|---|
| File Importer | `fileimporter@digiata.com` | Importer |
| Approver User | `approver@digiata.com` | Approver |

---

## Signing in

| ID | Rule |
|---|---|
| SI-01 | A person signs in with their email address and password. Both are required. |
| SI-02 | If the email or the password is wrong, the app says "Invalid email or password". It never says which of the two was wrong. |
| SI-03 | If the app cannot be reached, the message says so, so the person can tell a connection problem from a wrong password. |
| SI-04 | The sign-in screen tells a person who has forgotten their password to contact their administrator. |
| SI-05 | After signing in, an importer lands on the Upload screen and an approver lands on the Transactions screen. |
| SI-06 | A person who has done nothing in the app for 60 minutes is signed out and returned to the sign-in screen. Any activity resets the 60 minutes. |
| SI-07 | A person can be signed in in one place at a time. Signing in on a second device or browser signs them out of the first. |
| SI-08 | A person can sign out at any time. Signing out ends their sign-in on every device. |
| SI-09 | The app always shows who is signed in. |

---

## The transaction file

The bank supplies one file per day, named in the form `transactions_2026-04-15.csv`. It is a comma-separated text file with a header row followed by one row per transaction.

### The supplied example file

An example file, `TestFiles/transactions_2026-04-15.csv`, is supplied with this brief. Build the app to accept it as it is, and use it to try the app out. Its first rows are:

```
Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency
TXN-20260415-0001,2026/04/15 08:12,1001-2034-5567,Salary deposit - April,15750,C,ZAR
TXN-20260415-0002,2026/04/15 08:34,1001-2034-5567,Woolworths Sandton,487.32,D,ZAR
TXN-20260415-0003,2026/04/15 09:05,1001-2034-5567,Engen Garage fuel,650,D,ZAR
```

Every row in the example file is valid. Uploading it into an empty app gives this result:

| What you see | Expected |
|---|---|
| File status | **Completed** |
| Rows in the file | 20 |
| Transactions loaded | 20, all **Imported** |
| Credits | 5, totalling 28,927.82 ZAR |
| Debits | 15, totalling 12,229.39 ZAR |
| Uploading the same file again | Fails as a duplicate (FP-01) |

### The columns

| Column | What it holds |
|---|---|
| Reference | The bank's unique reference for the transaction, for example `TXN-20260415-0001`. |
| TransactionDate | The date and time of the transaction, for example `2026/04/15 08:12`. |
| AccountNumber | The account the transaction belongs to, for example `1001-2034-5567`. |
| Description | A free-text description. It can be empty. |
| Amount | The amount, never negative, with up to two decimal places. |
| TransactionType | `C` for a credit, `D` for a debit. |
| Currency | The three-letter currency code. All current files use `ZAR`. |

The amount is never negative. Whether money came in or went out is carried by the transaction type, never by a minus sign.

---

## Uploading a file

Only importers upload files.

| ID | Rule |
|---|---|
| UP-01 | The importer can drag a file onto the Upload screen or choose it from their computer. |
| UP-02 | The importer chooses what kind of file it is. There is one kind today, **Bank transactions**, and the app selects it for them. |
| UP-03 | The app accepts only `.csv` files. When it refuses a file, the message says what kind of file it expects. |
| UP-04 | The file name must not be empty, must be 255 characters or fewer, and must not contain `..`, `\`, `/`, or `:`. Otherwise the app refuses the upload with the message "Invalid file name". |
| UP-05 | While the file uploads, the screen shows progress. When the upload finishes, the app confirms with "<file name> has been uploaded successfully." |
| UP-06 | If the upload fails part way, the app says so and lets the importer try again. |
| UP-07 | An upload only hands the file over. Checking and loading happen afterwards, and the importer follows them on the dashboard and the file's detail screen without having to refresh. |

---

## How the app processes a file

As soon as a file is uploaded, the app works through these stages in order. Each stage is recorded in the file's processing history with the time it started and finished.

| Stage | What happens |
|---|---|
| 1. Receive | The app keeps a copy of the original file, records who uploaded it and when, and counts the transaction rows in it, not counting the header. |
| 2. Duplicate check | The app checks whether exactly the same file has already been brought in (rule FP-01). A duplicate stops here and fails. |
| 3. Read rows | The app reads each row. A row with an empty Reference is ignored, not reported as an error. |
| 4. Convert types | `C` becomes **Credit** and `D` becomes **Debit**. |
| 5. Check rows | The app checks every row against the row rules (FP-03). |
| 6. Wait for corrections | If any row breaks a rule, the file stops here until the importer corrects the rows or cancels the file. Nothing from the file is loaded while it waits. |
| 7. Load | The app turns every row into a transaction with the status **Imported**, skipping any whose reference already exists (FP-05). |

| ID | Rule |
|---|---|
| FP-01 | A file is a duplicate when its content is identical to another file that is uploaded, processing, completed, or waiting for corrections. Earlier files that were cancelled or that failed as duplicates do not count. A file with no transaction rows is never treated as a duplicate. |
| FP-02 | A duplicate file fails with a message naming the earlier file, for example "File is a duplicate of another file transactions_2026-04-15.csv". |
| FP-03 | A row is invalid when it breaks any of the row rules below. |
| FP-04 | Each invalid row carries every reason it failed, not only the first. |
| FP-05 | Transaction references are unique across the whole app, ignoring upper and lower case. When a row's reference already exists, the app skips that row and does not change the existing transaction. |
| FP-06 | A file is all or nothing. While any row is invalid, nothing from the file is loaded. |
| FP-07 | The file's summary shows how many rows were loaded, how many were skipped because their reference already existed, and how many were ignored because their reference was empty. The three always add up to the file's row count. |
| FP-08 | The app records "System" as the person who created each loaded transaction. |

### Row rules

| Rule | Reason shown on the row |
|---|---|
| The transaction type is `C` or `D`. | Invalid Transaction Type |
| The date can be read as a date and time. | Invalid Transaction Date |
| The amount is a number, not negative, with up to two decimal places. | Invalid Amount |
| The account number is not empty. | Missing Account Number |
| The reference appears only once in the file, ignoring upper and lower case. | Duplicate Reference In File |

---

## File statuses

Every file has one of four statuses.

| Status | Meaning |
|---|---|
| **Uploaded** | The app has received the file and has not started checking it. |
| **Processing** | The app is checking or loading the file. |
| **Completed** | The file's transactions are loaded and ready for approval. |
| **Failed** | The file is a duplicate, or it has invalid rows waiting for corrections. The file shows which. |

| ID | Rule |
|---|---|
| FS-01 | A file that failed as a duplicate stays failed. It cannot be retried. |
| FS-02 | A file that failed because of invalid rows can be corrected and checked again (rule FC-02). |
| FS-03 | The status is always shown as words, never as a colour alone. |

---

## Correcting a file

Only importers correct files.

| ID | Rule |
|---|---|
| FC-01 | For a file with invalid rows, the file's detail screen lists only the invalid rows, with every column from the file and the reason each row failed. |
| FC-02 | The importer can change the values on an invalid row and then ask the app to check the file again. |
| FC-03 | Checking again repeats stages 4 to 7. If every row now passes, the file loads and becomes **Completed**. If any row still fails, the file stays **Failed** and the list shows the rows that still fail and how many remain. |
| FC-04 | If the importer cannot correct the file, they cancel it (rules FX-01 to FX-06). |

---

## Cancelling a file

Only importers cancel files.

| ID | Rule |
|---|---|
| FX-01 | Before cancelling, the app asks for confirmation and names the file. The safe choice, keeping the file, is the default. |
| FX-02 | The app refuses to cancel a file that has at least one **Approved** transaction, and explains why. |
| FX-03 | Cancelling a file removes its transactions from the app, so they no longer appear in the transactions list, the summaries, or exports. Because they are removed, a corrected file with the same references can be uploaded later. |
| FX-04 | Cancelling a file also discards the app's copy of the original file, so it can no longer be downloaded. A file waiting for corrections stops waiting. |
| FX-05 | A cancelled file is hidden from the dashboard unless the person chooses to show cancelled files. |
| FX-06 | Cancelling a file that someone else has already cancelled does nothing and shows the file as cancelled. |

---

## The dashboard

The dashboard lists files. Both roles see it.

| ID | Rule |
|---|---|
| DB-01 | Above the list, the dashboard shows how many files are in each status, and how many transactions are **Imported**, **Approved**, and **Rejected** across all files that are not cancelled. Selecting a file count filters the list to that status. Selecting a transaction count opens the transactions list filtered to that status. |
| DB-02 | Each file shows its name, the date and time it was last processed, its number of rows, its status, and how many of its transactions are still **Imported**. |
| DB-03 | The file processed most recently appears first. The person can sort by any column, one at a time. |
| DB-04 | The list shows 20 files per page by default. The person can choose 5, 10, 20, or 50. |
| DB-05 | The person can filter by status, by file name, and by a range of process dates. |
| DB-06 | Cancelled files are hidden by default. The person can choose to see active files, cancelled files, or both. |
| DB-07 | Selecting a file opens its detail screen. |
| DB-08 | Importer only: a file that failed because of invalid rows offers a way to its correction screen straight from the list. |
| DB-09 | When there are no files, the dashboard says "No files yet". An importer also sees a link to upload one. |

---

## File details

Both roles see a file's details. The importer-only actions are marked.

| ID | Rule |
|---|---|
| FD-01 | The summary shows the file's total rows, how they were handled (FP-07), and how many of its transactions are **Imported**, **Approved**, and **Rejected**. |
| FD-02 | Selecting any of those counts opens the transactions list filtered to that file and that status. |
| FD-03 | When none of the file's transactions is still **Imported**, the summary says the file is fully reviewed. |
| FD-04 | The processing history lists each stage the file has been through, with the time it started and finished. |
| FD-05 | Any signed-in person can download the original file exactly as it was uploaded. |
| FD-06 | A **Failed** file shows the reason it failed. For invalid rows, the importer also sees the correction screen (FC-01). |
| FD-07 | A file still **Uploaded** or **Processing** says that its transactions are not available yet. |
| FD-08 | Importer only: the cancel action. |

---

## Transactions

A transaction holds the values from its row in the file, plus:

| Field | What it holds |
|---|---|
| File | The file the transaction came from. |
| Status | **Imported**, **Approved**, or **Rejected**. |
| Rejection reason | The approver's reason. Present only on a rejected transaction. |
| Last changed by | The person who last changed the transaction, or "System" when it was loaded. |
| Last changed on | The date and time of that change. |

### Transaction statuses

```
Imported ──approve──▶ Approved
    │
    └──reject + reason──▶ Rejected
```

| ID | Rule |
|---|---|
| TS-01 | Every loaded transaction starts as **Imported**. |
| TS-02 | Only an **Imported** transaction can be approved or rejected. |
| TS-03 | **Approved** and **Rejected** are final. Nothing can change a transaction once it reaches either. |
| TS-04 | The app enforces TS-02 and TS-03 itself. Hiding the buttons is not enough: no route through the app may change a final transaction. |

### The transactions list

The transactions list is the approver's main working screen. Importers see it too, without the actions.

| ID | Rule |
|---|---|
| TL-01 | Each transaction shows its reference, date and time, account, description, amount, currency, credit or debit, status, and the file it came from. |
| TL-02 | The most recent transaction date appears first. The person can sort by any column, one at a time. The chosen sort stays in place while they move between pages. |
| TL-03 | The list shows 20 transactions per page by default. The person can choose 5, 10, 20, or 50. |
| TL-04 | An approver sees **Approve** and **Reject** on every **Imported** transaction, and on no other. |
| TL-05 | An importer never sees **Approve**, **Reject**, or **Export**. |
| TL-06 | Opening a transaction shows all its details. A rejected transaction shows its rejection reason, which cannot be edited. |
| TL-07 | For approvers, the Transactions menu item shows how many transactions are still **Imported**. It shows the exact number up to 99, then "99+", and nothing when the number is zero. |
| TL-08 | When there are no transactions at all, the list says "No transactions yet". |

### Searching and filtering

Filtering works the same way for both roles.

| ID | Rule |
|---|---|
| SF-01 | The person can filter by status, by file, by a range of transaction dates, by a range of amounts, and by text that matches the reference or the account number. |
| SF-02 | Filters combine. A transaction must match every active filter to appear. |
| SF-03 | Each active filter is shown on screen, and one action clears them all. |
| SF-04 | When filters match nothing, the list says no transactions match, shows the active filters, and offers to clear them. |

### Approving a transaction

Only approvers approve.

| ID | Rule |
|---|---|
| AP-01 | Before approving, the app asks for confirmation and names the transaction's reference. Cancelling is the default choice. |
| AP-02 | On confirmation, the status becomes **Approved** and the list updates straight away. A short message confirms the approval. |
| AP-03 | The app records who approved the transaction and when. |
| AP-04 | If someone else approved or rejected the transaction first, the app does not change it. It tells the approver and shows the transaction's current status. |

### Rejecting a transaction

Only approvers reject.

| ID | Rule |
|---|---|
| RJ-01 | Rejecting asks for a reason. The reason is required, and the app does not let the approver submit until they have entered one. |
| RJ-02 | The reason can be up to 500 characters. The app shows how many characters remain. |
| RJ-03 | On submission, the status becomes **Rejected**, the reason is stored with the transaction, and the list updates straight away. A short message confirms the rejection. |
| RJ-04 | The app records who rejected the transaction and when. |
| RJ-05 | If someone else approved or rejected the transaction first, the app does not change it. It tells the approver and shows the transaction's current status. |

### Exporting transactions

Only approvers export.

| ID | Rule |
|---|---|
| EX-01 | Export produces a `.csv` file of exactly the transactions that match the current filters, across all pages, not only the page on screen. |
| EX-02 | With no filters active, export includes every transaction. |
| EX-03 | The export has the same columns as the transactions list, plus the rejection reason, who last changed each transaction, and when. |
| EX-04 | The export's file name includes the export date and describes the active filters, for example `transactions_Imported_2026-04-15.csv`. |
| EX-05 | When the current filters match nothing, export is unavailable and the app explains why. |
| EX-06 | The export opens cleanly in a spreadsheet program. |

---

## Menu and access

| Menu item | Importer | Approver |
|---|---|---|
| Dashboard | Yes | Yes |
| Transactions | Yes, view only | Yes |
| Upload | Yes | No |

| ID | Rule |
|---|---|
| AC-01 | A person never sees a menu item, button, or action their role does not allow. The app hides it rather than showing it disabled. |
| AC-02 | If a person reaches a screen their role does not allow, for example through a saved link, the app tells them they do not have access and who to ask. |
| AC-03 | The app enforces every role rule itself, not only by hiding things on screen. |

---

## General

| ID | Rule |
|---|---|
| GN-01 | The app works on a phone as well as on a desktop. On a narrow screen, lists show the key details of each row and keep its actions available. |
| GN-02 | Every action can be done with the keyboard alone. |
| GN-03 | Every icon-only button has a label that appears when the person points at it or moves to it with the keyboard. |
| GN-04 | Required fields on a form are marked. The app checks a field when the person leaves it and again when they submit, not on every keystroke. |
| GN-05 | Success messages disappear on their own after a few seconds. Problems that need attention stay on screen until resolved. |

---

## Not in scope

These are deliberately left out of this benchmark.


- **Configuring file kinds.** Bank transactions is the only kind of file, and it is fixed.
- **Collecting files from a shared folder.** Files arrive only by upload.
- **Currencies other than ZAR**, and any currency conversion.
- **Password reset, account lockout, and two-step sign-in.**
