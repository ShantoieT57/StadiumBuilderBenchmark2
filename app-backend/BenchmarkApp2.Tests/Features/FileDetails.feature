Feature: File details
  Both roles see a file's details, for active and cancelled files alike. The summary shows the
  file's total rows, how they were handled (FP-07), and how many of its transactions are Imported,
  Approved and Rejected (FD-01). It says when the file is fully reviewed, that is Completed, not
  cancelled and with none of its transactions still Imported (FD-03); a Completed file with no
  transactions at all is fully reviewed, since nothing from it awaits review. The details include
  the processing history: each stage the file has been through, in order, with the time it started
  and finished (FD-04). A Failed file shows why it failed (FD-06). A file still Uploaded or
  Processing says its transactions are not available yet (FD-07). The original file can be
  downloaded until the file is cancelled (FD-05, FX-04).

  Scenario Outline: A loaded file shows its summary and processing history
    Given the current time is "2026-04-15T08:00:00Z"
    And I am signed in as "fileimporter@digiata.com"
    And I have uploaded the sample file "transactions_2026-04-15.csv"
    And the current time is "2026-04-15T08:05:00Z"
    And the file processor has processed the waiting files
    And I am signed in as "<email>"
    When I request the details of the last uploaded file
    Then the response status code is 200
    And the file details are:
      | field                      | value                       |
      | fileName                   | transactions_2026-04-15.csv |
      | kind                       | BankTransactions            |
      | status                     | Completed                   |
      | failureKind                |                             |
      | failureReason              |                             |
      | uploadedBy                 | File Importer               |
      | uploadedAt                 | 2026-04-15T08:00:00Z        |
      | lastProcessedAt            | 2026-04-15T08:05:00Z        |
      | isCancelled                | false                       |
      | cancelledAt                |                             |
      | rowCount                   | 20                          |
      | loadedCount                | 20                          |
      | skippedExistingCount       | 0                           |
      | ignoredEmptyReferenceCount | 0                           |
      | transactions.imported      | 20                          |
      | transactions.approved      | 0                           |
      | transactions.rejected      | 0                           |
      | isFullyReviewed            | false                       |
      | areTransactionsAvailable   | true                        |
      | canDownload                | true                        |
    And the details are for the last uploaded file
    And the processing history in the details is:
      | stage          | started              | finished             |
      | Receive        | 2026-04-15T08:05:00Z | 2026-04-15T08:05:00Z |
      | DuplicateCheck | 2026-04-15T08:05:00Z | 2026-04-15T08:05:00Z |
      | ReadRows       | 2026-04-15T08:05:00Z | 2026-04-15T08:05:00Z |
      | ConvertTypes   | 2026-04-15T08:05:00Z | 2026-04-15T08:05:00Z |
      | CheckRows      | 2026-04-15T08:05:00Z | 2026-04-15T08:05:00Z |
      | Load           | 2026-04-15T08:05:00Z | 2026-04-15T08:05:00Z |

    Examples:
      | email                    |
      | fileimporter@digiata.com |
      | approver@digiata.com     |

  Scenario: Rows skipped as existing and ignored for an empty reference are counted
    Given I am signed in as "fileimporter@digiata.com"
    And I have uploaded a file named "first.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | First       | 10     | C               | ZAR      |
    And the file processor has processed the waiting files
    And I have uploaded a file named "second.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | txn-1     | 2026/04/15 08:12 | 1001          | Existing    | 10     | C               | ZAR      |
      | TXN-2     | 2026/04/15 08:13 | 1001          | New         | 20     | D               | ZAR      |
      |           | 2026/04/15 08:14 | 1001          | No ref      | 30     | D               | ZAR      |
    And the file processor has processed the waiting files
    When I request the details of the last uploaded file
    Then the response status code is 200
    And the file details are:
      | field                      | value |
      | rowCount                   | 3     |
      | loadedCount                | 1     |
      | skippedExistingCount       | 1     |
      | ignoredEmptyReferenceCount | 1     |
      | transactions.imported      | 1     |

  Scenario: A file with invalid rows shows why it failed and that it waits for corrections
    Given the current time is "2026-04-15T09:00:00Z"
    And I am signed in as "fileimporter@digiata.com"
    And I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Valid       | 10     | C               | ZAR      |
      | TXN-2     | 2026/04/15 08:13 | 1001          | Bad type    | 20     | X               | ZAR      |
    And the file processor has processed the waiting files
    When I request the details of the last uploaded file
    Then the response status code is 200
    And the file details are:
      | field                      | value                  |
      | status                     | Failed                 |
      | failureKind                | InvalidRows            |
      | failureReason              | File has 1 invalid row |
      | rowCount                   | 2                      |
      | loadedCount                |                        |
      | skippedExistingCount       |                        |
      | ignoredEmptyReferenceCount |                        |
      | transactions.imported      | 0                      |
      | isFullyReviewed            | false                  |
      | areTransactionsAvailable   | true                   |
      | canDownload                | true                   |
    And the processing history in the details is:
      | stage              | started              | finished             |
      | Receive            | 2026-04-15T09:00:00Z | 2026-04-15T09:00:00Z |
      | DuplicateCheck     | 2026-04-15T09:00:00Z | 2026-04-15T09:00:00Z |
      | ReadRows           | 2026-04-15T09:00:00Z | 2026-04-15T09:00:00Z |
      | ConvertTypes       | 2026-04-15T09:00:00Z | 2026-04-15T09:00:00Z |
      | CheckRows          | 2026-04-15T09:00:00Z | 2026-04-15T09:00:00Z |
      | WaitForCorrections | 2026-04-15T09:00:00Z |                      |

  Scenario: A duplicate file shows why it failed
    Given I am signed in as "fileimporter@digiata.com"
    And I have uploaded the sample file "transactions_2026-04-15.csv"
    And I have uploaded the sample file "transactions_2026-04-15.csv" named "copy.csv"
    And the file processor has processed the waiting files
    When I request the details of the last uploaded file
    Then the response status code is 200
    And the file details are:
      | field         | value                                                         |
      | fileName      | copy.csv                                                      |
      | status        | Failed                                                        |
      | failureKind   | Duplicate                                                     |
      | failureReason | File is a duplicate of another file transactions_2026-04-15.csv |
    And the processing history in the details lists the stages "Receive, DuplicateCheck"

  Scenario: A file that has not been processed yet has no processing history and no transactions yet
    Given I am signed in as "fileimporter@digiata.com"
    And I have uploaded the sample file "transactions_2026-04-15.csv"
    When I request the details of the last uploaded file
    Then the response status code is 200
    And the file details are:
      | field                    | value    |
      | status                   | Uploaded |
      | lastProcessedAt          |          |
      | rowCount                 |          |
      | areTransactionsAvailable | false    |
      | isFullyReviewed          | false    |
    And the processing history in the details lists the stages ""

  Scenario Outline: The summary says whether transactions are available and the file is fully reviewed
    Given these files exist:
      | name     | status   | imported   | approved   | rejected   | cancelled   |
      | file.csv | <status> | <imported> | <approved> | <rejected> | <cancelled> |
    And I am signed in as "approver@digiata.com"
    When I request the details of the file "file.csv"
    Then the response status code is 200
    And the file details are:
      | field                    | value        |
      | status                   | <status>     |
      | transactions.imported    | <imported>   |
      | transactions.approved    | <approved>   |
      | transactions.rejected    | <rejected>   |
      | isFullyReviewed          | <reviewed>   |
      | areTransactionsAvailable | <available>  |
      | isCancelled              | <isCancelled> |
      | canDownload              | <download>   |

    Examples:
      | case                                 | status     | imported | approved | rejected | cancelled | reviewed | available | isCancelled | download |
      | waiting to be processed              | Uploaded   | 0        | 0        | 0        | no        | false    | false     | false       | true     |
      | being processed                      | Processing | 0        | 0        | 0        | no        | false    | false     | false       | true     |
      | some transactions still imported     | Completed  | 2        | 1        | 1        | no        | false    | true      | false       | true     |
      | every transaction reviewed           | Completed  | 0        | 3        | 1        | no        | true     | true      | false       | true     |
      | completed with no transactions       | Completed  | 0        | 0        | 0        | no        | true     | true      | false       | true     |
      | failed                               | Failed     | 0        | 0        | 0        | no        | false    | true      | false       | true     |
      | cancelled                            | Completed  | 0        | 0        | 0        | yes       | false    | true      | true        | false    |

  Scenario Outline: A cancelled file shows when it was cancelled to both roles
    Given the current time is "2026-04-16T10:30:00Z"
    And these files exist:
      | name          | status | failure kind | cancelled |
      | cancelled.csv | Failed | InvalidRows  | yes       |
    And I am signed in as "<email>"
    When I request the details of the file "cancelled.csv"
    Then the response status code is 200
    And the file details are:
      | field       | value                |
      | isCancelled | true                 |
      | cancelledAt | 2026-04-16T10:30:00Z |
      | canDownload | false                |

    Examples:
      | email                    |
      | fileimporter@digiata.com |
      | approver@digiata.com     |

  Scenario: An unknown file is not found
    Given I am signed in as "approver@digiata.com"
    When I request the details of a file that does not exist
    Then the response status code is 404
    And the response message is "File not found"

  Scenario: File details require a signed-in session
    Given these files exist:
      | name     |
      | file.csv |
    When I request the details of the file "file.csv"
    Then the response status code is 401
    And the response reason is "NotSignedIn"
