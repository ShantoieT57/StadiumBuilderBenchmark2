Feature: Transaction details
  Opening a transaction shows all its details (TL-06): its values from the file, its status, the
  file it came from, who created it and when, who last changed it and when, and, on a rejected
  transaction only, the rejection reason. Both roles can open a transaction.
  A field value of "{file name}" stands for the id of the seeded file with that name.

  Scenario Outline: An imported transaction shows all its details
    Given these transactions exist:
      | reference | date                   | account    | description | amount | currency | type  | status   | file      | created at           |
      | TXN-001   | 2026-04-15 08:30:15.5  | 1234567890 | Salary      | 1500   | ZAR      | Debit | Imported | april.csv | 2026-04-16T10:00:00Z |
    And I am signed in as "<email>"
    When I open the transaction "TXN-001"
    Then the response status code is 200
    And the transaction's amount is exactly 1500.00
    And the transaction details are:
      | field           | value                  |
      | reference       | TXN-001                |
      | transactionDate | 2026-04-15T08:30:15.5  |
      | accountNumber   | 1234567890             |
      | description     | Salary                 |
      | currency        | ZAR                    |
      | transactionType | Debit                  |
      | status          | Imported               |
      | file.id         | {april.csv}            |
      | file.fileName   | april.csv              |
      | createdBy       | System                 |
      | createdAt       | 2026-04-16T10:00:00Z   |
      | lastChangedBy   | System                 |
      | lastChangedAt   | 2026-04-16T10:00:00Z   |
      | rejectionReason |                        |

    Examples:
      | email                    |
      | fileimporter@digiata.com |
      | approver@digiata.com     |

  Scenario: A rejected transaction shows its rejection reason and who rejected it
    Given these transactions exist:
      | reference | amount | status   | rejection reason              | file    | created at           | last changed by | last changed at      |
      | TXN-009   | 0.5    | Rejected | Duplicate payment; see TXN-01 | may.csv | 2026-04-16T10:00:00Z | Approver        | 2026-04-17T14:45:30Z |
    And I am signed in as "fileimporter@digiata.com"
    When I open the transaction "TXN-009"
    Then the response status code is 200
    And the transaction's amount is exactly 0.50
    And the transaction details are:
      | field           | value                         |
      | status          | Rejected                      |
      | rejectionReason | Duplicate payment; see TXN-01 |
      | createdBy       | System                        |
      | createdAt       | 2026-04-16T10:00:00Z          |
      | lastChangedBy   | Approver                      |
      | lastChangedAt   | 2026-04-17T14:45:30Z          |
      | file.fileName   | may.csv                       |

  Scenario: An approved transaction has no rejection reason
    Given these transactions exist:
      | reference | status   | last changed by |
      | TXN-002   | Approved | Approver        |
    And I am signed in as "approver@digiata.com"
    When I open the transaction "TXN-002"
    Then the response status code is 200
    And the transaction details are:
      | field           | value    |
      | status          | Approved |
      | lastChangedBy   | Approver |
      | rejectionReason |          |

  Scenario: An unknown transaction is not found
    Given I am signed in as "approver@digiata.com"
    When I open the transaction with the id "6b9f8f0e-5d7c-4a0f-9a55-1d7f0a6c2b11"
    Then the response status code is 404
    And the response message is "Transaction not found"

  Scenario: A transaction of a cancelled file is not found
    Given these files exist:
      | name          | cancelled | imported |
      | cancelled.csv | yes       | 1        |
    And I am signed in as "approver@digiata.com"
    When I open the first transaction of the file "cancelled.csv"
    Then the response status code is 404
    And the response message is "Transaction not found"

  Scenario: Opening a transaction requires a signed-in session
    Given these transactions exist:
      | reference |
      | TXN-001   |
    When I open the transaction "TXN-001"
    Then the response status code is 401
    And the response reason is "NotSignedIn"
