Feature: Process an uploaded file
  After an upload only hands a file over (UP-07), the file processor works through the stages in
  order: Receive, Duplicate check, Read rows, Convert types, Check rows, Wait for corrections and
  Load. Each stage is recorded in the file's processing history with the time it started and
  finished. A file with only valid rows is loaded: every row becomes an Imported transaction created
  by "System" (FP-08), rows whose reference already exists are skipped (FP-05) and rows with an empty
  reference are ignored, and the three counts always add up to the file's row count (FP-07).

  Background:
    Given I am signed in as "fileimporter@digiata.com"

  Scenario: The supplied sample file is loaded into an empty app
    Given I have uploaded the sample file "transactions_2026-04-15.csv"
    When the file processor processes the waiting files
    Then the last uploaded file has the status "Completed"
    And the last uploaded file has 20 rows
    And the last uploaded file has 20 rows loaded, 0 skipped as existing and 0 ignored for an empty reference
    And the last uploaded file was last processed at the current time
    And 20 transactions have been loaded from the last uploaded file, all with the status "Imported"
    And the transactions from the last uploaded file include 5 of type "Credit" totalling 28927.82 "ZAR"
    And the transactions from the last uploaded file include 15 of type "Debit" totalling 12229.39 "ZAR"
    And every transaction from the last uploaded file was created and last changed by "System" at the current time

  Scenario: A loaded transaction keeps the values from its row
    Given I have uploaded a file named "values.csv" with the content:
      """
      Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency
      TXN-1,2026/04/15 08:12,1001-2034-5567,"Refund, ""urgent"" order",1299.99,C,ZAR
      TXN-2,2026-04-16T17:45:30,2002-0000-1111,,0.5,D,ZAR
      """
    When the file processor processes the waiting files
    Then the last uploaded file has the status "Completed"
    And the transactions loaded from the last uploaded file are:
      | Reference | TransactionDate     | AccountNumber  | Description             | Amount  | TransactionType | Currency | Status   |
      | TXN-1     | 2026-04-15 08:12:00 | 1001-2034-5567 | Refund, "urgent" order  | 1299.99 | Credit          | ZAR      | Imported |
      | TXN-2     | 2026-04-16 17:45:30 | 2002-0000-1111 |                         | 0.50    | Debit           | ZAR      | Imported |

  Scenario: A description may span several lines when it is quoted
    Given I have uploaded a file named "multiline.csv" with the content:
      """
      Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency
      TXN-1,2026/04/15 08:12,1001-2034-5567,"First line
      second line",10,C,ZAR
      """
    When the file processor processes the waiting files
    Then the last uploaded file has the status "Completed"
    And the last uploaded file has 1 rows
    And the last uploaded file has 1 rows loaded, 0 skipped as existing and 0 ignored for an empty reference

  Scenario: Rows with an empty reference are ignored rather than reported
    Given I have uploaded a file named "empty-references.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description    | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Kept           | 10     | C               | ZAR      |
      |           | 2026/04/15 08:13 | 1001          | Ignored        | 20     | D               | ZAR      |
      |           | not a date       |               | Ignored as bad | -5     | X               | ZAR      |
    When the file processor processes the waiting files
    Then the last uploaded file has the status "Completed"
    And the last uploaded file has 3 rows
    And the last uploaded file has 1 rows loaded, 0 skipped as existing and 2 ignored for an empty reference
    And 1 transactions have been loaded from the last uploaded file, all with the status "Imported"

  Scenario: Rows whose reference already exists are skipped, ignoring upper and lower case
    Given I have uploaded a file named "first.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Original    | 10     | C               | ZAR      |
    And the file processor has processed the waiting files
    And I have uploaded a file named "second.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | txn-1     | 2026/04/16 09:00 | 2002          | Replacement | 99     | D               | ZAR      |
      | TXN-2     | 2026/04/16 09:30 | 2002          | New         | 20     | D               | ZAR      |
    When the file processor processes the waiting files
    Then the last uploaded file has the status "Completed"
    And the last uploaded file has 2 rows
    And the last uploaded file has 1 rows loaded, 1 skipped as existing and 0 ignored for an empty reference
    And the transaction "TXN-1" still has the description "Original" and belongs to uploaded file 1

  Scenario: A file with no transaction rows is completed with nothing loaded
    Given I have uploaded a file named "header-only.csv" with the content:
      """
      Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency
      """
    When the file processor processes the waiting files
    Then the last uploaded file has the status "Completed"
    And the last uploaded file has 0 rows
    And the last uploaded file has 0 rows loaded, 0 skipped as existing and 0 ignored for an empty reference

  Scenario: Blank lines are not counted as rows
    Given I have uploaded a file named "blank-lines.csv" with the content:
      """
      Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency

      TXN-1,2026/04/15 08:12,1001,Test,10,C,ZAR

      """
    When the file processor processes the waiting files
    Then the last uploaded file has the status "Completed"
    And the last uploaded file has 1 rows

  Scenario: The processing history records every stage of a loaded file
    Given I have uploaded the sample file "transactions_2026-04-15.csv"
    When the file processor processes the waiting files
    Then the processing history of the last uploaded file lists the stages:
      | Stage          |
      | Receive        |
      | DuplicateCheck |
      | ReadRows       |
      | ConvertTypes   |
      | CheckRows      |
      | Load           |
    And every stage in the processing history of the last uploaded file started and finished at the current time

  Scenario: Every file waiting to be processed is processed, oldest first
    Given I have uploaded a file named "first.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | First       | 10     | C               | ZAR      |
    And 1 minutes pass
    And I have uploaded a file named "second.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Second      | 10     | C               | ZAR      |
    When the file processor processes the waiting files
    Then uploaded file 1 has the status "Completed"
    And uploaded file 2 has the status "Completed"
    And the transaction "TXN-1" still has the description "First" and belongs to uploaded file 1
