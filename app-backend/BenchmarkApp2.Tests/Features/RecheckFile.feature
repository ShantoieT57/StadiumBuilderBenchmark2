Feature: Checking a corrected file again
  The importer corrects the values on a file's invalid rows and asks the app to check the file again
  (FC-02, FS-02). The corrections are saved and the file is checked again in one step, and the
  outcome is returned straight away. Checking again repeats stages 4 to 7 over every row of the file
  using the corrected values, without repeating the duplicate-file check (FC-03). If every row now
  passes, the file loads and becomes Completed; if any row still fails, the file stays Failed and the
  rows that still fail are returned with how many remain. Only importers correct files. Rows are
  identified by their stable ids, and only the file's invalid rows can be corrected.

  Background:
    Given I am signed in as "fileimporter@digiata.com"

  Scenario: Correcting every invalid row loads the file and completes it
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Valid       | 10     | C               | ZAR      |
      | TXN-2     | not a date       | 1001          | Bad date    | 20     | D               | ZAR      |
      | TXN-3     | 2026/04/15 09:00 |               | Several     | abc    | X               | ZAR      |
      |           | 2026/04/15 09:00 | 1001          | Ignored     | 5      | C               | ZAR      |
    And the file processor has processed the waiting files
    When I re-check the last uploaded file with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 2   | TXN-2     | 2026/04/15 08:30 | 1001          | Fixed date  | 20     | D               | ZAR      |
      | 3   | TXN-3     | 2026-04-15 09:00 | 1002          | Fixed       | 30.50  | C               | USD      |
    Then the response status code is 200
    And the re-check result status is "Completed"
    And the rows that still fail are:
      | Row | Reference | TransactionDate | AccountNumber | Description | Amount | TransactionType | Currency | Reasons |
    And the number of rows that still fail is 0
    And the re-checked file details are:
      | field                      | value     |
      | status                     | Completed |
      | failureKind                |           |
      | failureReason              |           |
      | rowCount                   | 4         |
      | loadedCount                | 3         |
      | skippedExistingCount       | 0         |
      | ignoredEmptyReferenceCount | 1         |
      | transactions.imported      | 3         |
    And the last uploaded file has the status "Completed"
    And the last uploaded file has 3 rows loaded, 0 skipped as existing and 1 ignored for an empty reference
    And the last uploaded file was last processed at the current time
    And the transactions loaded from the last uploaded file are:
      | Reference | TransactionDate     | AccountNumber | Description | Amount | TransactionType | Currency | Status   |
      | TXN-1     | 2026-04-15 08:12:00 | 1001          | Valid       | 10     | Credit          | ZAR      | Imported |
      | TXN-2     | 2026-04-15 08:30:00 | 1001          | Fixed date  | 20     | Debit           | ZAR      | Imported |
      | TXN-3     | 2026-04-15 09:00:00 | 1002          | Fixed       | 30.50  | Credit          | USD      | Imported |
    And every transaction from the last uploaded file was created and last changed by "System" at the current time

  Scenario: Correcting only some invalid rows leaves the file failed with the rows that still fail
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Valid       | 10     | C               | ZAR      |
      | TXN-2     | not a date       | 1001          | Bad date    | 20     | D               | ZAR      |
      | TXN-3     | 2026/04/15 09:00 | 1001          | Bad type    | 30     | X               | ZAR      |
      | TXN-4     | 2026/04/15 10:00 | 1001          | Bad amount  | -1     | C               | ZAR      |
    And the file processor has processed the waiting files
    When I re-check the last uploaded file with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 2   | TXN-2     | 2026/04/15 08:30 | 1001          | Fixed date  | 20     | D               | ZAR      |
      | 3   | TXN-3     | 2026/04/15 09:00 | 1001          | Still bad   | 30     | Y               | ZAR      |
    Then the response status code is 200
    And the re-check result status is "Failed"
    And the rows that still fail are:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency | Reasons                  |
      | 3   | TXN-3     | 2026/04/15 09:00 | 1001          | Still bad   | 30     | Y               | ZAR      | Invalid Transaction Type |
      | 4   | TXN-4     | 2026/04/15 10:00 | 1001          | Bad amount  | -1     | C               | ZAR      | Invalid Amount           |
    And the number of rows that still fail is 2
    And the re-checked file details are:
      | field         | value                  |
      | status        | Failed                 |
      | failureKind   | InvalidRows            |
      | failureReason | File has 2 invalid rows |
    And the last uploaded file has failed because of invalid rows with the reason "File has 2 invalid rows"
    And the last uploaded file was last processed at the current time
    And no transactions have been loaded
    And the rows kept for corrections of the last uploaded file are:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency | Columns | ExtraValues | Reasons                  |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Valid       | 10     | C               | ZAR      | 7       |             |                          |
      | 2   | TXN-2     | 2026/04/15 08:30 | 1001          | Fixed date  | 20     | D               | ZAR      | 7       |             |                          |
      | 3   | TXN-3     | 2026/04/15 09:00 | 1001          | Still bad   | 30     | Y               | ZAR      | 7       |             | Invalid Transaction Type |
      | 4   | TXN-4     | 2026/04/15 10:00 | 1001          | Bad amount  | -1     | C               | ZAR      | 7       |             | Invalid Amount           |
    When I request the invalid rows of the last uploaded file
    Then the response status code is 200
    And the number of invalid rows remaining is 2

  Scenario: The remaining rows can be corrected in a later re-check
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | not a date       | 1001          | Bad date    | 10     | C               | ZAR      |
      | TXN-2     | 2026/04/15 09:00 | 1001          | Bad type    | 20     | X               | ZAR      |
    And the file processor has processed the waiting files
    And I have re-checked the last uploaded file with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 1   | TXN-1     | 2026/04/15 08:00 | 1001          | Fixed date  | 10     | C               | ZAR      |
    When I re-check the last uploaded file with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 2   | TXN-2     | 2026/04/15 09:00 | 1001          | Fixed type  | 20     | D               | ZAR      |
    Then the response status code is 200
    And the re-check result status is "Completed"
    And the last uploaded file has 2 rows loaded, 0 skipped as existing and 0 ignored for an empty reference

  Scenario: Correcting a repeated reference clears the duplicate on the other row too
    Given I have uploaded a file named "repeated.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | First       | 10     | C               | ZAR      |
      | txn-1     | 2026/04/15 09:00 | 1001          | Second      | 20     | D               | ZAR      |
    And the file processor has processed the waiting files
    When I re-check the last uploaded file with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 2   | TXN-2     | 2026/04/15 09:00 | 1001          | Second      | 20     | D               | ZAR      |
    Then the response status code is 200
    And the re-check result status is "Completed"
    And the last uploaded file has 2 rows loaded, 0 skipped as existing and 0 ignored for an empty reference

  Scenario: A correction that repeats another row's reference makes both rows invalid
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Valid       | 10     | C               | ZAR      |
      | TXN-2     | 2026/04/15 09:00 | 1001          | Bad amount  | ten    | D               | ZAR      |
    And the file processor has processed the waiting files
    When I re-check the last uploaded file with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 2   | ' txn-1 ' | 2026/04/15 09:00 | 1001          | Bad amount  | 10     | D               | ZAR      |
    Then the response status code is 200
    And the re-check result status is "Failed"
    And the rows that still fail are:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency | Reasons                     |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Valid       | 10     | C               | ZAR      | Duplicate Reference In File |
      | 2   | ' txn-1 ' | 2026/04/15 09:00 | 1001          | Bad amount  | 10     | D               | ZAR      | Duplicate Reference In File |
    And the number of rows that still fail is 2
    And the last uploaded file has failed because of invalid rows with the reason "File has 2 invalid rows"

  Scenario: A correction can introduce a new error on the corrected row
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad amount  | ten    | C               | ZAR      |
    And the file processor has processed the waiting files
    When I re-check the last uploaded file with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 1   | TXN-1     | 15/04/2026       |               | Bad amount  | 10     | C               | ZAR      |
    Then the response status code is 200
    And the re-check result status is "Failed"
    And the rows that still fail are:
      | Row | Reference | TransactionDate | AccountNumber | Description | Amount | TransactionType | Currency | Reasons                                         |
      | 1   | TXN-1     | 15/04/2026      |               | Bad amount  | 10     | C               | ZAR      | Invalid Transaction Date; Missing Account Number |
    And the last uploaded file has failed because of invalid rows with the reason "File has 1 invalid row"

  Scenario: A corrected reference that already exists in the app is skipped
    Given I have uploaded a file named "earlier.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-9     | 2026/04/14 08:00 | 1001          | Original    | 99     | C               | ZAR      |
    And I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Valid       | 10     | C               | ZAR      |
      | TXN-2     | 2026/04/15 09:00 | 1001          | Bad amount  | ten    | D               | ZAR      |
    And the file processor has processed the waiting files
    When I re-check the last uploaded file with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 2   | txn-9     | 2026/04/15 09:00 | 1001          | Corrected   | 10     | D               | ZAR      |
    Then the response status code is 200
    And the re-check result status is "Completed"
    And the last uploaded file has 1 rows loaded, 1 skipped as existing and 0 ignored for an empty reference
    And the transaction "TXN-9" still has the description "Original" and belongs to uploaded file 1

  Scenario: A row whose reference is emptied by a correction is ignored
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Valid       | 10     | C               | ZAR      |
      | TXN-2     | 2026/04/15 09:00 | 1001          | Bad amount  | ten    | D               | ZAR      |
    And the file processor has processed the waiting files
    When I re-check the last uploaded file with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 2   | '  '      | 2026/04/15 09:00 | 1001          | Bad amount  | ten    | D               | ZAR      |
    Then the response status code is 200
    And the re-check result status is "Completed"
    And the last uploaded file has 1 rows loaded, 0 skipped as existing and 1 ignored for an empty reference

  Scenario: A corrected row has exactly seven columns
    Given I have uploaded a file named "columns.csv" with the content:
      """
      Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency
      TXN-1,2026/04/15 08:12,1001,Too many,10,C,ZAR,surplus,more
      TXN-2,2026/04/15 08:12,1001
      """
    And the file processor has processed the waiting files
    When I re-check the last uploaded file with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Too many    | 10     | C               | ZAR      |
      | 2   | TXN-2     | 2026/04/15 08:12 | 1001          | Too few     | ten    | D               | ZAR      |
    Then the response status code is 200
    And the re-check result status is "Failed"
    And the rows kept for corrections of the last uploaded file are:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency | Columns | ExtraValues | Reasons        |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Too many    | 10     | C               | ZAR      | 7       |             |                |
      | 2   | TXN-2     | 2026/04/15 08:12 | 1001          | Too few     | ten    | D               | ZAR      | 7       |             | Invalid Amount |

  Scenario: Rows keep their ids when the file is checked again
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Valid       | 10     | C               | ZAR      |
      | TXN-2     | not a date       | 1001          | Bad date    | 20     | D               | ZAR      |
      | TXN-3     | 2026/04/15 09:00 | 1001          | Bad type    | 30     | X               | ZAR      |
    And the file processor has processed the waiting files
    And I have noted the row ids of the last uploaded file
    When I re-check the last uploaded file with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 2   | TXN-1     | 2026/04/15 08:30 | 1001          | Repeats     | 20     | D               | ZAR      |
    Then the response status code is 200
    And the re-check result status is "Failed"
    And every row of the last uploaded file still has its noted id
    And the rows that still fail have their noted ids

  Scenario: Checking again is recorded in the processing history
    Given the current time is "2026-05-01T10:00:00Z"
    And I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | not a date       | 1001          | Bad date    | 10     | C               | ZAR      |
      | TXN-2     | 2026/04/15 09:00 | 1001          | Bad type    | 20     | X               | ZAR      |
    And the file processor has processed the waiting files
    And the current time is "2026-05-01T10:20:00Z"
    When I re-check the last uploaded file with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 1   | TXN-1     | 2026/04/15 08:00 | 1001          | Fixed date  | 10     | C               | ZAR      |
    Then the processing history in the re-check result is:
      | stage              | started              | finished             |
      | Receive            | 2026-05-01T10:00:00Z | 2026-05-01T10:00:00Z |
      | DuplicateCheck     | 2026-05-01T10:00:00Z | 2026-05-01T10:00:00Z |
      | ReadRows           | 2026-05-01T10:00:00Z | 2026-05-01T10:00:00Z |
      | ConvertTypes       | 2026-05-01T10:00:00Z | 2026-05-01T10:00:00Z |
      | CheckRows          | 2026-05-01T10:00:00Z | 2026-05-01T10:00:00Z |
      | WaitForCorrections | 2026-05-01T10:00:00Z | 2026-05-01T10:20:00Z |
      | ConvertTypes       | 2026-05-01T10:20:00Z | 2026-05-01T10:20:00Z |
      | CheckRows          | 2026-05-01T10:20:00Z | 2026-05-01T10:20:00Z |
      | WaitForCorrections | 2026-05-01T10:20:00Z |                      |
    Given the current time is "2026-05-01T10:40:00Z"
    When I re-check the last uploaded file with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 2   | TXN-2     | 2026/04/15 09:00 | 1001          | Fixed type  | 20     | D               | ZAR      |
    Then the processing history in the re-check result is:
      | stage              | started              | finished             |
      | Receive            | 2026-05-01T10:00:00Z | 2026-05-01T10:00:00Z |
      | DuplicateCheck     | 2026-05-01T10:00:00Z | 2026-05-01T10:00:00Z |
      | ReadRows           | 2026-05-01T10:00:00Z | 2026-05-01T10:00:00Z |
      | ConvertTypes       | 2026-05-01T10:00:00Z | 2026-05-01T10:00:00Z |
      | CheckRows          | 2026-05-01T10:00:00Z | 2026-05-01T10:00:00Z |
      | WaitForCorrections | 2026-05-01T10:00:00Z | 2026-05-01T10:20:00Z |
      | ConvertTypes       | 2026-05-01T10:20:00Z | 2026-05-01T10:20:00Z |
      | CheckRows          | 2026-05-01T10:20:00Z | 2026-05-01T10:20:00Z |
      | WaitForCorrections | 2026-05-01T10:20:00Z | 2026-05-01T10:40:00Z |
      | ConvertTypes       | 2026-05-01T10:40:00Z | 2026-05-01T10:40:00Z |
      | CheckRows          | 2026-05-01T10:40:00Z | 2026-05-01T10:40:00Z |
      | Load               | 2026-05-01T10:40:00Z | 2026-05-01T10:40:00Z |

  Scenario: The original uploaded file is not changed by corrections
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad amount  | ten    | C               | ZAR      |
    And the file processor has processed the waiting files
    When I re-check the last uploaded file with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Fixed       | 10     | C               | ZAR      |
    Then the response status code is 200
    And the re-check result status is "Completed"
    And downloading the last uploaded file still returns exactly the bytes that were uploaded

  Scenario: Only one re-check of a file succeeds when two run at the same time
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad amount  | ten    | C               | ZAR      |
    And the file processor has processed the waiting files
    When I re-check the last uploaded file twice at the same time with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Fixed       | 10     | C               | ZAR      |
    Then one re-check completed the file and the other was refused because the file is not waiting for corrections
    And 1 transactions have been loaded in total
    And the processing history of the last uploaded file lists the stages:
      | Stage              |
      | Receive            |
      | DuplicateCheck     |
      | ReadRows           |
      | ConvertTypes       |
      | CheckRows          |
      | WaitForCorrections |
      | ConvertTypes       |
      | CheckRows          |
      | Load               |

  Scenario: An approver cannot correct a file
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad amount  | ten    | C               | ZAR      |
    And the file processor has processed the waiting files
    And I am signed in as "approver@digiata.com"
    When I re-check the last uploaded file with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Fixed       | 10     | C               | ZAR      |
    Then the response status code is 403
    And the response message is "You do not have access to this. Please ask your administrator for access."
    And the last uploaded file has failed because of invalid rows with the reason "File has 1 invalid row"

  Scenario Outline: A file that is not waiting for corrections cannot be checked again
    Given these files exist:
      | name     | status   | failure kind | cancelled   |
      | file.csv | <status> | <kind>       | <cancelled> |
    When I re-check the file "file.csv" without corrections
    Then the response status code is 409
    And the response message is "This file is not waiting for corrections."

    Examples:
      | case                        | status     | kind        | cancelled |
      | waiting to be processed     | Uploaded   |             | no        |
      | being processed             | Processing |             | no        |
      | completed                   | Completed  |             | no        |
      | failed as a duplicate       | Failed     | Duplicate   | no        |
      | cancelled with invalid rows | Failed     | InvalidRows | yes       |

  Scenario: A file that has been loaded by an earlier re-check cannot be checked again
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad amount  | ten    | C               | ZAR      |
    And the file processor has processed the waiting files
    And I have re-checked the last uploaded file with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Fixed       | 10     | C               | ZAR      |
    When I re-check the last uploaded file without corrections
    Then the response status code is 409
    And the response message is "This file is not waiting for corrections."

  Scenario Outline: Only the file's invalid rows can be corrected
    Given I have uploaded a file named "other.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | OTH-1     | 2026/04/15 08:12 | 1001          | Other file  | ten    | C               | ZAR      |
    And I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Valid       | 10     | C               | ZAR      |
      | TXN-2     | 2026/04/15 09:00 | 1001          | Bad amount  | ten    | D               | ZAR      |
    And the file processor has processed the waiting files
    When I re-check the last uploaded file correcting <row>
    Then the response status code is 400
    And the response message is "<message>"
    And the last uploaded file has failed because of invalid rows with the reason "File has 1 invalid row"
    And the rows kept for corrections of the last uploaded file are:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency | Columns | ExtraValues | Reasons        |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Valid       | 10     | C               | ZAR      | 7       |             |                |
      | 2   | TXN-2     | 2026/04/15 09:00 | 1001          | Bad amount  | ten    | D               | ZAR      | 7       |             | Invalid Amount |
    And the processing history of the last uploaded file lists the stages:
      | Stage              |
      | Receive            |
      | DuplicateCheck     |
      | ReadRows           |
      | ConvertTypes       |
      | CheckRows          |
      | WaitForCorrections |

    Examples:
      | case                     | row                                     | message                                           |
      | a valid row              | its valid row 1                         | Only the file's invalid rows can be corrected.    |
      | a row of another file    | the invalid row of uploaded file 1      | Only the file's invalid rows can be corrected.    |
      | an unknown row           | a row that does not exist               | Only the file's invalid rows can be corrected.    |
      | the same row twice       | its invalid row 2 twice                 | Each row can be corrected only once in a request. |

  Scenario: Every column of a correction must be given
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad amount  | ten    | C               | ZAR      |
    And the file processor has processed the waiting files
    When I re-check the last uploaded file correcting row 1 without a currency
    Then the response status code is 400
    And the validation errors are for exactly the fields "corrections[0].currency"
    And the validation errors for the field "corrections[0].currency" are "The Currency field is required."
    And the last uploaded file has failed because of invalid rows with the reason "File has 1 invalid row"

  Scenario Outline: Validation errors on the request body are keyed by camelCase JSON paths
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad amount  | ten    | C               | ZAR      |
    And the file processor has processed the waiting files
    When I re-check the last uploaded file with the request body '<body>'
    Then the response status code is 400
    And the validation errors are for exactly the fields "<fields>"
    And the last uploaded file has failed because of invalid rows with the reason "File has 1 invalid row"

    Examples:
      | case                    | body                                                                                                                                                                                  | fields                   |
      | missing columns         | {"corrections": [{"id": "{row 1}", "reference": "TXN-1", "transactionDate": "2026/04/15 08:12", "accountNumber": "1001", "description": "Fixed", "amount": "10"}]}                    | corrections[0].transactionType, corrections[0].currency |
      | amount sent as a number | {"corrections": [{"id": "{row 1}", "reference": "TXN-1", "transactionDate": "2026/04/15 08:12", "accountNumber": "1001", "description": "Fixed", "amount": 10, "transactionType": "C", "currency": "ZAR"}]} | corrections[0].amount, $ |
      | row id not a UUID       | {"corrections": [{"id": "row-1", "reference": "TXN-1", "transactionDate": "2026/04/15 08:12", "accountNumber": "1001", "description": "Fixed", "amount": "10", "transactionType": "C", "currency": "ZAR"}]} | corrections[0].id, $     |
      | corrections not a list  | {"corrections": {"id": "{row 1}"}}                                                                                                                                                     | corrections, $           |

  Scenario: An unknown file is not found
    When I re-check a file that does not exist
    Then the response status code is 404
    And the response message is "File not found"

  Scenario: Checking a file again requires a signed-in session
    Given these files exist:
      | name     | status | failure kind |
      | file.csv | Failed | InvalidRows  |
    And my requests carry no session cookie
    When I re-check the file "file.csv" without corrections
    Then the response status code is 401
    And the response reason is "NotSignedIn"
