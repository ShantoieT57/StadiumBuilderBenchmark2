Feature: Refuse duplicate files
  A file is a duplicate when its content is identical to an earlier file that is uploaded,
  processing, completed, or waiting for corrections. Earlier files that were cancelled or that
  failed as duplicates do not count, and a file with no transaction rows is never a duplicate
  (FP-01). A duplicate fails with a message naming the earlier file (FP-02) and stays failed
  (FS-01): nothing after the duplicate check runs for it.

  Background:
    Given I am signed in as "fileimporter@digiata.com"

  Scenario: Uploading the sample file again fails as a duplicate
    Given I have uploaded the sample file "transactions_2026-04-15.csv"
    And the file processor has processed the waiting files
    And I have uploaded the sample file "transactions_2026-04-15.csv"
    When the file processor processes the waiting files
    Then uploaded file 1 has the status "Completed"
    And the last uploaded file has failed as a duplicate with the reason "File is a duplicate of another file transactions_2026-04-15.csv"
    And the last uploaded file has 20 rows
    And the last uploaded file was last processed at the current time
    And 20 transactions have been loaded in total
    And the processing history of the last uploaded file lists the stages:
      | Stage          |
      | Receive        |
      | DuplicateCheck |

  Scenario: The duplicate names the earlier file even when the names differ
    Given I have uploaded the sample file "transactions_2026-04-15.csv"
    And I have uploaded the sample file "transactions_2026-04-15.csv" named "copy.csv"
    When the file processor processes the waiting files
    Then uploaded file 1 has the status "Completed"
    And the last uploaded file has failed as a duplicate with the reason "File is a duplicate of another file transactions_2026-04-15.csv"

  Scenario: A file that is still being processed counts as an earlier file
    Given I have uploaded the sample file "transactions_2026-04-15.csv"
    And uploaded file 1 has been left with the status "Processing"
    And I have uploaded the sample file "transactions_2026-04-15.csv" named "copy.csv"
    When the file processor processes the waiting files
    Then the last uploaded file has failed as a duplicate with the reason "File is a duplicate of another file transactions_2026-04-15.csv"

  Scenario: A file waiting for corrections counts as an earlier file
    Given I have uploaded a file named "invalid.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad type    | 10     | X               | ZAR      |
    And the file processor has processed the waiting files
    And I have uploaded a file named "invalid-again.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad type    | 10     | X               | ZAR      |
    When the file processor processes the waiting files
    Then uploaded file 1 has the status "Failed"
    And the last uploaded file has failed as a duplicate with the reason "File is a duplicate of another file invalid.csv"

  Scenario: A cancelled file does not count as an earlier file
    Given I have uploaded the sample file "transactions_2026-04-15.csv"
    And the file processor has processed the waiting files
    And uploaded file 1 has been cancelled
    And I have uploaded the sample file "transactions_2026-04-15.csv"
    When the file processor processes the waiting files
    Then the last uploaded file has the status "Completed"
    And the last uploaded file has 20 rows loaded, 0 skipped as existing and 0 ignored for an empty reference

  Scenario: A file that failed as a duplicate does not count as an earlier file
    Given I have uploaded the sample file "transactions_2026-04-15.csv"
    And the file processor has processed the waiting files
    And I have uploaded the sample file "transactions_2026-04-15.csv"
    And the file processor has processed the waiting files
    And uploaded file 1 has been cancelled
    And I have uploaded the sample file "transactions_2026-04-15.csv"
    When the file processor processes the waiting files
    Then uploaded file 2 has the status "Failed"
    And the last uploaded file has the status "Completed"

  Scenario Outline: A file with no transaction rows is never a duplicate
    Given I have uploaded a file named "first.csv" with the content:
      """
      <content>
      """
    And the file processor has processed the waiting files
    And I have uploaded a file named "second.csv" with the content:
      """
      <content>
      """
    When the file processor processes the waiting files
    Then uploaded file 1 has the status "Completed"
    And the last uploaded file has the status "Completed"
    And the last uploaded file has 0 rows

    Examples:
      | case        | content                                                                           |
      | header only | Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency |
      | empty file  |                                                                                   |

  Scenario: A file with different content is not a duplicate
    Given I have uploaded a file named "first.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | One         | 10     | C               | ZAR      |
    And the file processor has processed the waiting files
    And I have uploaded a file named "first.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-2     | 2026/04/15 08:12 | 1001          | Two         | 10     | C               | ZAR      |
    When the file processor processes the waiting files
    Then the last uploaded file has the status "Completed"
