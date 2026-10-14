Feature: Cancelling a file
  Only importers cancel files (FC-04, FD-08). A file with at least one Approved transaction cannot be
  cancelled, and the app explains why (FX-02); Imported and Rejected transactions do not prevent it.
  Cancelling removes the file's transactions from the app, so they no longer count anywhere and a
  corrected file with the same references can be loaded later (FX-03). It discards the app's copy of
  the original file, and a file waiting for corrections stops waiting (FX-04). The cancel is
  recorded, with who did it, in the file's details and processing history. A cancelled file is
  hidden from the dashboard by default (FX-05, DB-06). Cancelling a file that is already cancelled
  does nothing and shows the file as cancelled (FX-06).

  Background:
    Given I am signed in as "fileimporter@digiata.com"

  Scenario: Cancelling a completed file removes its transactions from every count
    Given these files exist:
      | name       | status    | rows | imported | approved | rejected |
      | other.csv  | Completed | 4    | 2        | 1        | 1        |
      | loaded.csv | Completed | 4    | 3        | 0        | 1        |
    And the current time is "2026-04-16T10:30:00Z"
    When I cancel the file "loaded.csv"
    Then the response status code is 200
    And the file details are:
      | field                 | value                |
      | fileName              | loaded.csv           |
      | status                | Completed            |
      | isCancelled           | true                 |
      | cancelledAt           | 2026-04-16T10:30:00Z |
      | cancelledBy           | File Importer        |
      | transactions.imported | 0                    |
      | transactions.approved | 0                    |
      | transactions.rejected | 0                    |
      | isFullyReviewed       | false                |
      | canDownload           | false                |
    And the file "loaded.csv" has no transactions left
    When I request the dashboard summary
    Then the dashboard counts 0 Uploaded, 0 Processing, 1 Completed and 0 Failed files
    And the dashboard counts 2 Imported, 1 Approved and 1 Rejected transactions
    When I list the files
    Then the listed file names are "other.csv"
    When I list the files with the query "visibility=Cancelled"
    Then the listed files are:
      | name       | imported | cancelled |
      | loaded.csv | 0        | yes       |

  Scenario: Cancelling a file waiting for corrections stops it waiting
    Given the current time is "2026-05-01T10:00:00Z"
    And I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Valid       | 10     | C               | ZAR      |
      | TXN-2     | not a date       | 1001          | Bad date    | 20     | D               | ZAR      |
    And the file processor has processed the waiting files
    And the current time is "2026-05-01T10:20:00Z"
    When I cancel the last uploaded file
    Then the response status code is 200
    And the file details are:
      | field         | value                   |
      | status        | Failed                  |
      | failureKind   | InvalidRows             |
      | isCancelled   | true                    |
      | cancelledAt   | 2026-05-01T10:20:00Z    |
      | canDownload   | false                   |
    And the processing history in the details is:
      | stage              | started              | finished             |
      | Receive            | 2026-05-01T10:00:00Z | 2026-05-01T10:00:00Z |
      | DuplicateCheck     | 2026-05-01T10:00:00Z | 2026-05-01T10:00:00Z |
      | ReadRows           | 2026-05-01T10:00:00Z | 2026-05-01T10:00:00Z |
      | ConvertTypes       | 2026-05-01T10:00:00Z | 2026-05-01T10:00:00Z |
      | CheckRows          | 2026-05-01T10:00:00Z | 2026-05-01T10:00:00Z |
      | WaitForCorrections | 2026-05-01T10:00:00Z | 2026-05-01T10:20:00Z |
      | Cancelled          | 2026-05-01T10:20:00Z | 2026-05-01T10:20:00Z |
    And the last uploaded file has no rows kept for corrections
    When I re-check the last uploaded file without corrections
    Then the response status code is 409
    And the response message is "This file is not waiting for corrections."
    When I request the invalid rows of the last uploaded file
    Then the response status code is 409
    And no transactions have been loaded

  Scenario Outline: A file with approved transactions cannot be cancelled
    Given these files exist:
      | name         | status    | imported | approved   | rejected |
      | approved.csv | Completed | 2        | <approved> | 1        |
    When I cancel the file "approved.csv"
    Then the response status code is 409
    And the response message is "<message>"
    And the file "approved.csv" still has 2 Imported, <approved> Approved and 1 Rejected transactions
    When I request the details of the file "approved.csv"
    Then the file details are:
      | field       | value |
      | isCancelled | false |
      | cancelledAt |       |
      | cancelledBy |       |
      | canDownload | true  |
    And the processing history in the details lists the stages ""

    Examples:
      | approved | message                                                                      |
      | 1        | This file cannot be cancelled because 1 of its transactions has been approved. |
      | 3        | This file cannot be cancelled because 3 of its transactions have been approved. |

  Scenario: A file with only rejected transactions can be cancelled
    Given these files exist:
      | name         | status    | imported | approved | rejected |
      | rejected.csv | Completed | 0        | 0        | 2        |
    When I cancel the file "rejected.csv"
    Then the response status code is 200
    And the file details are:
      | field                 | value |
      | isCancelled           | true  |
      | transactions.rejected | 0     |
    And the file "rejected.csv" has no transactions left

  Scenario: A cancelled file can no longer be downloaded
    Given I have uploaded the sample file "transactions_2026-04-15.csv"
    And the file processor has processed the waiting files
    When I cancel the last uploaded file
    And I download the last uploaded file
    Then the response status code is 410
    And the response message is "The original file is no longer available because the file has been cancelled."

  Scenario: A corrected file with the same references loads after the first is cancelled
    Given I have uploaded a file named "first.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Wrong       | 10     | C               | ZAR      |
      | TXN-2     | 2026/04/15 09:00 | 1001          | Wrong       | 20     | D               | ZAR      |
    And the file processor has processed the waiting files
    And I have cancelled the last uploaded file
    And I have uploaded a file named "corrected.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Right       | 11     | C               | ZAR      |
      | TXN-2     | 2026/04/15 09:00 | 1001          | Right       | 22     | D               | ZAR      |
    When the file processor processes the waiting files
    Then the last uploaded file has the status "Completed"
    And the last uploaded file has 2 rows loaded, 0 skipped as existing and 0 ignored for an empty reference
    And the transactions loaded from the last uploaded file are:
      | Reference | TransactionDate     | AccountNumber | Description | Amount | TransactionType | Currency | Status   |
      | TXN-1     | 2026-04-15 08:12:00 | 1001          | Right       | 11     | Credit          | ZAR      | Imported |
      | TXN-2     | 2026-04-15 09:00:00 | 1001          | Right       | 22     | Debit           | ZAR      | Imported |
    And 2 transactions have been loaded in total

  Scenario: The same content loads again after the first upload is cancelled
    Given I have uploaded the sample file "transactions_2026-04-15.csv"
    And the file processor has processed the waiting files
    And I have cancelled the last uploaded file
    And I have uploaded the sample file "transactions_2026-04-15.csv"
    When the file processor processes the waiting files
    Then the last uploaded file has the status "Completed"
    And the last uploaded file has 20 rows loaded, 0 skipped as existing and 0 ignored for an empty reference

  Scenario: A cancelled file that is waiting to be processed is never processed
    Given the current time is "2026-05-01T10:00:00Z"
    And I have uploaded the sample file "transactions_2026-04-15.csv"
    When I cancel the last uploaded file
    Then the response status code is 200
    And the file details are:
      | field                    | value    |
      | status                   | Uploaded |
      | isCancelled              | true     |
      | areTransactionsAvailable | false    |
    When the file processor processes the waiting files
    Then the last uploaded file has the status "Uploaded"
    And no transactions have been loaded
    And the processing history of the last uploaded file lists the stages:
      | Stage     |
      | Cancelled |

  Scenario: A file claimed for processing whose processing has not started returns to Uploaded
    Given these files exist:
      | name        | status     |
      | claimed.csv | Processing |
    When I cancel the file "claimed.csv"
    Then the response status code is 200
    And the file details are:
      | field       | value    |
      | status      | Uploaded |
      | isCancelled | true     |

  Scenario: A file that is being processed is cancelled once its processing has finished
    Given I have uploaded the sample file "transactions_2026-04-15.csv"
    And a file processor is processing the last uploaded file
    When I start cancelling the last uploaded file
    Then the cancel is still waiting
    When the file processor finishes the last uploaded file as "Completed"
    Then the cancel finishes with the response status code 200
    And the file details are:
      | field       | value     |
      | status      | Completed |
      | isCancelled | true      |

  Scenario: Cancelling a file that is already cancelled changes nothing
    Given another importer "Second Importer" with the email "second.importer@digiata.com" exists
    And the current time is "2026-04-16T10:30:00Z"
    And I have uploaded the sample file "transactions_2026-04-15.csv"
    And the file processor has processed the waiting files
    And I have cancelled the last uploaded file
    And the current time is "2026-04-16T11:00:00Z"
    And I am signed in as "second.importer@digiata.com"
    When I cancel the last uploaded file
    Then the response status code is 200
    And the file details are:
      | field       | value                |
      | isCancelled | true                 |
      | cancelledAt | 2026-04-16T10:30:00Z |
      | cancelledBy | File Importer        |
    And the processing history in the details lists the stages "Receive, DuplicateCheck, ReadRows, ConvertTypes, CheckRows, Load, Cancelled"

  Scenario: An approver cannot cancel a file
    Given these files exist:
      | name     | status    | imported |
      | file.csv | Completed | 2        |
    And I am signed in as "approver@digiata.com"
    When I cancel the file "file.csv"
    Then the response status code is 403
    And the response message is "You do not have access to this. Please ask your administrator for access."
    And the file "file.csv" still has 2 Imported, 0 Approved and 0 Rejected transactions
    When I request the details of the file "file.csv"
    Then the file details are:
      | field       | value |
      | isCancelled | false |

  Scenario: An unknown file is not found
    When I cancel a file that does not exist
    Then the response status code is 404
    And the response message is "File not found"

  Scenario: Cancelling a file requires a signed-in session
    Given these files exist:
      | name     | status    |
      | file.csv | Completed |
    And my requests carry no session cookie
    When I cancel the file "file.csv"
    Then the response status code is 401
    And the response reason is "NotSignedIn"
