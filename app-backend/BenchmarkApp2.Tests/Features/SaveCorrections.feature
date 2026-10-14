Feature: Saving corrections without checking the file again
  The importer can save corrected values on a file's invalid rows without asking the app to check the
  file again yet (FC-02). The rows keep the reasons from the last check, so they stay invalid and can
  be corrected again; the saved values are used when the file is checked again. Only importers correct
  files, and only the file's invalid rows can be corrected.

  Background:
    Given I am signed in as "fileimporter@digiata.com"

  Scenario: Saved corrections are kept and the file still waits for corrections
    Given I have uploaded a file named "broken.csv" with the content:
      """
      Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency
      TXN-1,2026/04/15 08:12,1001,Valid,10,C,ZAR
      TXN-2,2026/04/15 09:00,1001,Bad amount,ten,D,ZAR,surplus
      TXN-3,2026/04/15 10:00,1001,Bad type,30,X,ZAR
      """
    And the file processor has processed the waiting files
    When I save the corrections to the last uploaded file:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 2   | TXN-2     | 2026/04/15 09:00 | 1001          | Fixed       | 20     | D               | ZAR      |
    Then the response status code is 200
    And the invalid rows are:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency | Reasons                                 |
      | 2   | TXN-2     | 2026/04/15 09:00 | 1001          | Fixed       | 20     | D               | ZAR      | Wrong Number Of Columns; Invalid Amount |
      | 3   | TXN-3     | 2026/04/15 10:00 | 1001          | Bad type    | 30     | X               | ZAR      | Invalid Transaction Type                |
    And the number of invalid rows remaining is 2
    And the last uploaded file has failed because of invalid rows with the reason "File has 2 invalid rows"
    And no transactions have been loaded
    And the rows kept for corrections of the last uploaded file are:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency | Columns | ExtraValues | Reasons                                 |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Valid       | 10     | C               | ZAR      | 7       |             |                                         |
      | 2   | TXN-2     | 2026/04/15 09:00 | 1001          | Fixed       | 20     | D               | ZAR      | 7       |             | Wrong Number Of Columns; Invalid Amount |
      | 3   | TXN-3     | 2026/04/15 10:00 | 1001          | Bad type    | 30     | X               | ZAR      | 7       |             | Invalid Transaction Type                |
    And the processing history of the last uploaded file lists the stages:
      | Stage              |
      | Receive            |
      | DuplicateCheck     |
      | ReadRows           |
      | ConvertTypes       |
      | CheckRows          |
      | WaitForCorrections |

  Scenario: Saved corrections are used when the file is checked again
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad amount  | ten    | C               | ZAR      |
      | TXN-2     | 2026/04/15 09:00 | 1001          | Bad type    | 20     | X               | ZAR      |
    And the file processor has processed the waiting files
    And I have saved the corrections to the last uploaded file:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Fixed       | 10     | C               | ZAR      |
    And I have saved the corrections to the last uploaded file:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 2   | TXN-2     | 2026/04/15 09:00 | 1001          | Fixed       | 20     | D               | ZAR      |
    When I re-check the last uploaded file without corrections
    Then the response status code is 200
    And the last uploaded file has the status "Completed"
    And the last uploaded file has 2 rows loaded, 0 skipped as existing and 0 ignored for an empty reference

  Scenario: An approver cannot save corrections
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad amount  | ten    | C               | ZAR      |
    And the file processor has processed the waiting files
    And I am signed in as "approver@digiata.com"
    When I save the corrections to the last uploaded file:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Fixed       | 10     | C               | ZAR      |
    Then the response status code is 403
    And the response message is "You do not have access to this. Please ask your administrator for access."

  Scenario: Corrections cannot be saved to a file that is not waiting for corrections
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad amount  | ten    | C               | ZAR      |
    And the file processor has processed the waiting files
    And I have re-checked the last uploaded file with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Fixed       | 10     | C               | ZAR      |
    When I save the corrections to the last uploaded file:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Again       | 10     | C               | ZAR      |
    Then the response status code is 409
    And the response message is "This file is not waiting for corrections."

  Scenario: A valid row cannot be corrected
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Valid       | 10     | C               | ZAR      |
      | TXN-2     | 2026/04/15 09:00 | 1001          | Bad amount  | ten    | D               | ZAR      |
    And the file processor has processed the waiting files
    When I save the corrections to the last uploaded file:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 2   | TXN-2     | 2026/04/15 09:00 | 1001          | Fixed       | 20     | D               | ZAR      |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Changed     | 10     | C               | ZAR      |
    Then the response status code is 400
    And the response message is "Only the file's invalid rows can be corrected."
    And the rows kept for corrections of the last uploaded file are:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency | Columns | ExtraValues | Reasons        |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Valid       | 10     | C               | ZAR      | 7       |             |                |
      | 2   | TXN-2     | 2026/04/15 09:00 | 1001          | Bad amount  | ten    | D               | ZAR      | 7       |             | Invalid Amount |

  Scenario: At least one row must be corrected
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad amount  | ten    | C               | ZAR      |
    And the file processor has processed the waiting files
    When I save no corrections to the last uploaded file
    Then the response status code is 400
    And the validation errors are for exactly the fields "rows"

  Scenario Outline: Validation errors on the request body are keyed by camelCase JSON paths
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad amount  | ten    | C               | ZAR      |
    And the file processor has processed the waiting files
    When I save the corrections to the last uploaded file with the request body '<body>'
    Then the response status code is 400
    And the validation errors are for exactly the fields "<fields>"
    And the rows kept for corrections of the last uploaded file are:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency | Columns | ExtraValues | Reasons        |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Bad amount  | ten    | C               | ZAR      | 7       |             | Invalid Amount |

    Examples:
      | case                    | body                                                                                                                                                                               | fields             |
      | missing rows            | {}                                                                                                                                                                                 | rows               |
      | missing amount          | {"rows": [{"id": "{row 1}", "reference": "TXN-1", "transactionDate": "2026/04/15 08:12", "accountNumber": "1001", "description": "Fixed", "transactionType": "C", "currency": "ZAR"}]} | rows[0].amount     |
      | amount sent as a number | {"rows": [{"id": "{row 1}", "reference": "TXN-1", "transactionDate": "2026/04/15 08:12", "accountNumber": "1001", "description": "Fixed", "amount": 10, "transactionType": "C", "currency": "ZAR"}]} | rows[0].amount, $ |
      | malformed JSON          | {"rows": [{"id": "{row 1}", "amount": "10"                                                                                                                                         | $                  |

  Scenario: A missing column keeps its validation message
    Given I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad amount  | ten    | C               | ZAR      |
    And the file processor has processed the waiting files
    When I save the corrections to the last uploaded file with the request body '{"rows": [{"id": "{row 1}", "reference": "TXN-1", "transactionDate": "2026/04/15 08:12", "accountNumber": "1001", "description": "Fixed", "transactionType": "C", "currency": "ZAR"}]}'
    Then the response status code is 400
    And the validation errors for the field "rows[0].amount" are "The Amount field is required."

  Scenario: An unknown file is not found
    When I save the corrections to a file that does not exist
    Then the response status code is 404
    And the response message is "File not found"
