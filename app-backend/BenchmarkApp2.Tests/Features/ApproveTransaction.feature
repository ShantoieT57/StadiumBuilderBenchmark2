Feature: Approving a transaction
  Only approvers approve (AC-03). Approving an Imported transaction makes it Approved and records who
  approved it and when (AP-02, AP-03); the transaction's details are returned so the list can update
  straight away. Only an Imported transaction can be approved, and Approved and Rejected are final
  (TS-02, TS-03, TS-04): if someone else approved or rejected it first, nothing changes and the
  approver is told its current status (AP-04).
  A field value of "{file name}" stands for the id of the seeded file with that name.

  Scenario: Approving an imported transaction records who approved it and when
    Given these transactions exist:
      | reference | status   | file      | created at           |
      | TXN-001   | Imported | april.csv | 2026-04-16T10:00:00Z |
    And I am signed in as "approver@digiata.com"
    And the current time is "2026-04-17T09:15:00Z"
    When I approve the transaction "TXN-001"
    Then the response status code is 200
    And the transaction details are:
      | field           | value                |
      | reference       | TXN-001              |
      | status          | Approved             |
      | file.id         | {april.csv}          |
      | file.fileName   | april.csv            |
      | createdBy       | System               |
      | createdAt       | 2026-04-16T10:00:00Z |
      | lastChangedBy   | Approver User        |
      | lastChangedAt   | 2026-04-17T09:15:00Z |
      | rejectionReason |                      |
    And the transaction "TXN-001" is stored as "Approved", last changed by "Approver User"
    When I open the transaction "TXN-001"
    Then the transaction details are:
      | field         | value                |
      | status        | Approved             |
      | lastChangedBy | Approver User        |
      | lastChangedAt | 2026-04-17T09:15:00Z |

  Scenario: An approval shows straight away in the list, the counts and the file's details
    Given these transactions exist:
      | reference | status   | file      |
      | TXN-001   | Imported | april.csv |
      | TXN-002   | Imported | april.csv |
      | TXN-003   | Approved | april.csv |
    And I am signed in as "approver@digiata.com"
    When I approve the transaction "TXN-001"
    Then the response status code is 200
    When I list the transactions with the query "status=Imported"
    Then the listed references are "TXN-002"
    When I request the number of imported transactions
    Then the number of imported transactions is 1
    When I request the dashboard summary
    Then the dashboard counts 1 Imported, 2 Approved and 0 Rejected transactions
    When I request the details of the file "april.csv"
    Then the file details are:
      | field                 | value |
      | transactions.imported | 1     |
      | transactions.approved | 2     |
      | isFullyReviewed       | false |
    When I approve the transaction "TXN-002"
    And I request the details of the file "april.csv"
    Then the file details are:
      | field                 | value |
      | transactions.imported | 0     |
      | transactions.approved | 3     |
      | isFullyReviewed       | true  |

  Scenario Outline: A transaction that is no longer Imported is not changed
    Given these transactions exist:
      | reference | status   | rejection reason | last changed by | last changed at      |
      | TXN-001   | <status> | <reason>         | Other Approver  | 2026-04-16T12:00:00Z |
    And I am signed in as "approver@digiata.com"
    And the current time is "2026-04-17T09:15:00Z"
    When I approve the transaction "TXN-001"
    Then the response status code is 409
    And the response message is "<message>"
    And the transaction details are:
      | field                       | value                |
      | transaction.reference       | TXN-001              |
      | transaction.status          | <status>             |
      | transaction.lastChangedBy   | Other Approver       |
      | transaction.lastChangedAt   | 2026-04-16T12:00:00Z |
      | transaction.rejectionReason | <reason>             |
    And the transaction "TXN-001" is stored as "<status>", last changed by "Other Approver"

    Examples:
      | status   | reason            | message                                     |
      | Approved |                   | This transaction has already been approved. |
      | Rejected | Duplicate payment | This transaction has already been rejected. |

  Scenario: An importer cannot approve a transaction
    Given these transactions exist:
      | reference |
      | TXN-001   |
    And I am signed in as "fileimporter@digiata.com"
    When I approve the transaction "TXN-001"
    Then the response status code is 403
    And the response message is "You do not have access to this. Please ask your administrator for access."
    And the transaction "TXN-001" is stored as "Imported", last changed by "System"

  Scenario: An unknown transaction is not found
    Given I am signed in as "approver@digiata.com"
    When I approve the transaction with the id "6b9f8f0e-5d7c-4a0f-9a55-1d7f0a6c2b11"
    Then the response status code is 404
    And the response message is "Transaction not found"

  Scenario: A transaction of a cancelled file is not found and not changed
    Given these files exist:
      | name          | cancelled | imported |
      | cancelled.csv | yes       | 1        |
    And I am signed in as "approver@digiata.com"
    When I approve the first transaction of the file "cancelled.csv"
    Then the response status code is 404
    And the response message is "Transaction not found"
    And the file "cancelled.csv" still has 1 Imported, 0 Approved and 0 Rejected transactions

  Scenario: Approving a transaction requires a signed-in session
    Given these transactions exist:
      | reference |
      | TXN-001   |
    When I approve the transaction "TXN-001"
    Then the response status code is 401
    And the response reason is "NotSignedIn"
    And the transaction "TXN-001" is stored as "Imported", last changed by "System"
