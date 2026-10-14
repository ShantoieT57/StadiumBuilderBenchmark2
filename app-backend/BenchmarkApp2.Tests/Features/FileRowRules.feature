Feature: Check the rows of a file
  Every row with a reference is checked against the row rules (FP-03), and an invalid row carries
  every reason it failed, not only the first (FP-04). While any row is invalid the file is Failed,
  waiting for corrections, and nothing from it is loaded (FP-06, FS-02). Every row is kept with its
  original values, its row number and its reasons so it can be corrected and checked again later.
  A row with the wrong number of columns is invalid with the reason "Wrong Number Of Columns"; its
  missing columns are treated as empty and are checked like any other value.

  Background:
    Given I am signed in as "fileimporter@digiata.com"

  Scenario Outline: A transaction type other than C or D is invalid
    Given I have uploaded a file with one valid row and a row with the transaction type "<type>"
    When the file processor processes the waiting files
    Then the last uploaded file has failed because of invalid rows with the reason "File has 1 invalid row"
    And the invalid rows of the last uploaded file are:
      | Row | Reasons                  |
      | 2   | Invalid Transaction Type |
    And no transactions have been loaded

    Examples:
      | type   |
      | X      |
      | Credit |
      | c      |
      |        |

  Scenario Outline: A transaction date that cannot be read as a date and time is invalid
    Given I have uploaded a file with one valid row and a row with the transaction date "<date>"
    When the file processor processes the waiting files
    Then the last uploaded file has failed because of invalid rows with the reason "File has 1 invalid row"
    And the invalid rows of the last uploaded file are:
      | Row | Reasons                  |
      | 2   | Invalid Transaction Date |

    Examples:
      | date             |
      | not a date       |
      | 2026/04/15       |
      | 15/04/2026 08:12 |
      | 2026/13/01 08:12 |
      | 2026/02/30 08:12 |
      | 2026/04/15 25:00 |
      |                  |

  Scenario Outline: Unambiguous date and time forms are accepted
    Given I have uploaded a file with one valid row and a row with the transaction date "<date>"
    When the file processor processes the waiting files
    Then the last uploaded file has the status "Completed"
    And the transaction "TXN-2" has the transaction date "<stored>"

    Examples:
      | date                    | stored              |
      | 2026/04/15 08:12        | 2026-04-15 08:12:00 |
      | 2026/4/5 8:12           | 2026-04-05 08:12:00 |
      | 2026/04/15 08:12:45     | 2026-04-15 08:12:45 |
      | 2026-04-15 08:12        | 2026-04-15 08:12:00 |
      | 2026-04-15T08:12        | 2026-04-15 08:12:00 |
      | 2026-04-15T08:12:45     | 2026-04-15 08:12:45 |
      | 2026-04-15T08:12:45.500 | 2026-04-15 08:12:45.5 |

  Scenario Outline: An amount that is not a number, is negative or has more than two decimal places is invalid
    Given I have uploaded a file with one valid row and a row with the amount "<amount>"
    When the file processor processes the waiting files
    Then the last uploaded file has failed because of invalid rows with the reason "File has 1 invalid row"
    And the invalid rows of the last uploaded file are:
      | Row | Reasons        |
      | 2   | Invalid Amount |

    Examples:
      | amount              |
      | -5                  |
      | 1.234               |
      | abc                 |
      | 1,000.00            |
      | 1e3                 |
      | 10000000000000000   |
      |                     |

  Scenario Outline: Amounts that are numbers with up to two decimal places are accepted
    Given I have uploaded a file with one valid row and a row with the amount "<amount>"
    When the file processor processes the waiting files
    Then the last uploaded file has the status "Completed"
    And the transaction "TXN-2" has the amount "<stored>"

    Examples:
      | amount  | stored  |
      | 0       | 0.00    |
      | 15750   | 15750.00 |
      | 45.5    | 45.50   |
      | 1299.99 | 1299.99 |
      | 0.01    | 0.01    |

  Scenario: A row without an account number is invalid
    Given I have uploaded a file with one valid row and a row with the account number ""
    When the file processor processes the waiting files
    Then the last uploaded file has failed because of invalid rows with the reason "File has 1 invalid row"
    And the invalid rows of the last uploaded file are:
      | Row | Reasons                |
      | 2   | Missing Account Number |

  Scenario: Every occurrence of a reference repeated in the file is invalid, ignoring upper and lower case
    Given I have uploaded a file named "repeated.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | First       | 10     | C               | ZAR      |
      | TXN-2     | 2026/04/15 08:13 | 1001          | Unique      | 20     | D               | ZAR      |
      | txn-1     | 2026/04/15 08:14 | 1001          | Second      | 30     | D               | ZAR      |
      | Txn-1     | 2026/04/15 08:15 | 1001          | Third       | 40     | D               | ZAR      |
    When the file processor processes the waiting files
    Then the last uploaded file has failed because of invalid rows with the reason "File has 3 invalid rows"
    And the invalid rows of the last uploaded file are:
      | Row | Reasons                     |
      | 1   | Duplicate Reference In File |
      | 3   | Duplicate Reference In File |
      | 4   | Duplicate Reference In File |
    And no transactions have been loaded

  Scenario: An invalid row carries every reason it failed
    Given I have uploaded a file named "many-reasons.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | yesterday        |               | Everything  | -1     | Z               | ZAR      |
      | txn-1     | 2026/04/15 08:12 | 1001          | Repeat      | 10     | C               | ZAR      |
    When the file processor processes the waiting files
    Then the last uploaded file has failed because of invalid rows with the reason "File has 2 invalid rows"
    And the invalid rows of the last uploaded file are:
      | Row | Reasons                                                                                                                  |
      | 1   | Invalid Transaction Type; Invalid Transaction Date; Invalid Amount; Missing Account Number; Duplicate Reference In File |
      | 2   | Duplicate Reference In File                                                                                              |

  Scenario: A row with the wrong number of columns is invalid
    Given I have uploaded a file named "columns.csv" with the content:
      """
      Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency
      TXN-1,2026/04/15 08:12,1001,Too few columns
      TXN-2,2026/04/15 08:12,1001,Too many,10,C,ZAR,extra
      TXN-3,2026/04/15 08:12,1001,Fine,10,C,ZAR
      """
    When the file processor processes the waiting files
    Then the last uploaded file has failed because of invalid rows with the reason "File has 2 invalid rows"
    And the invalid rows of the last uploaded file are:
      | Row | Reasons                                                          |
      | 1   | Wrong Number Of Columns; Invalid Transaction Type; Invalid Amount |
      | 2   | Wrong Number Of Columns                                          |

  Scenario: Nothing is loaded and every row is kept for corrections while any row is invalid
    Given I have uploaded a file named "keep-rows.csv" with the content:
      """
      Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency
      TXN-1,2026/04/15 08:12,1001,"Valid, with a comma",10,C,ZAR
      TXN-2,2026/04/15 08:13,,Missing account,20,X,ZAR
      ,2026/04/15 08:14,1001,Ignored,30,D,ZAR
      TXN-4,2026/04/15 08:15,1001,Extra,40,D,ZAR,surplus,more
      """
    When the file processor processes the waiting files
    Then the last uploaded file has failed because of invalid rows with the reason "File has 2 invalid rows"
    And the last uploaded file has 4 rows
    And no transactions have been loaded
    And the last uploaded file was last processed at the current time
    And the rows kept for corrections of the last uploaded file are:
      | Row | Reference | TransactionDate  | AccountNumber | Description         | Amount | TransactionType | Currency | Columns | ExtraValues  | Reasons                                          |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Valid, with a comma | 10     | C               | ZAR      | 7       |              |                                                  |
      | 2   | TXN-2     | 2026/04/15 08:13 |               | Missing account     | 20     | X               | ZAR      | 7       |              | Invalid Transaction Type; Missing Account Number |
      | 3   |           | 2026/04/15 08:14 | 1001          | Ignored             | 30     | D               | ZAR      | 7       |              |                                                  |
      | 4   | TXN-4     | 2026/04/15 08:15 | 1001          | Extra               | 40     | D               | ZAR      | 9       | surplus;more | Wrong Number Of Columns                          |

  Scenario: The processing history shows a file with invalid rows waiting for corrections
    Given I have uploaded a file with one valid row and a row with the amount "-1"
    When the file processor processes the waiting files
    Then the processing history of the last uploaded file lists the stages:
      | Stage              |
      | Receive            |
      | DuplicateCheck     |
      | ReadRows           |
      | ConvertTypes       |
      | CheckRows          |
      | WaitForCorrections |
    And the stage "WaitForCorrections" of the last uploaded file started at the current time and has not finished
