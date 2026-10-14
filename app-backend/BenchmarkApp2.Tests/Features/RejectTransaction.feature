Feature: Rejecting a transaction
  Only approvers reject (AC-03). Rejecting needs a reason (RJ-01) of at most 500 characters (RJ-02).
  Whitespace at the start and end of the reason is removed before it is checked and stored, and
  characters are counted as UTF-16 code units, as a JavaScript string's length counts them.
  Rejecting an Imported transaction makes it Rejected, stores the reason and records who rejected it
  and when (RJ-03, RJ-04); the transaction's details are returned so the list can update straight
  away. Only an Imported transaction can be rejected, and Approved and Rejected are final (TS-02,
  TS-03, TS-04): if someone else approved or rejected it first, nothing changes and the approver is
  told its current status (RJ-05).

  Scenario: Rejecting an imported transaction stores the reason and who rejected it and when
    Given these transactions exist:
      | reference | status   | file      | created at           |
      | TXN-001   | Imported | april.csv | 2026-04-16T10:00:00Z |
    And I am signed in as "approver@digiata.com"
    And the current time is "2026-04-17T09:15:00Z"
    When I reject the transaction "TXN-001" with the reason "Duplicate payment; see TXN-0001"
    Then the response status code is 200
    And the transaction details are:
      | field           | value                           |
      | reference       | TXN-001                         |
      | status          | Rejected                        |
      | file.fileName   | april.csv                       |
      | createdBy       | System                          |
      | createdAt       | 2026-04-16T10:00:00Z            |
      | lastChangedBy   | Approver User                   |
      | lastChangedAt   | 2026-04-17T09:15:00Z            |
      | rejectionReason | Duplicate payment; see TXN-0001 |
    And the transaction "TXN-001" is stored as "Rejected", last changed by "Approver User"
    And the transaction "TXN-001" has the stored rejection reason "Duplicate payment; see TXN-0001"
    When I open the transaction "TXN-001"
    Then the transaction details are:
      | field           | value                           |
      | status          | Rejected                        |
      | lastChangedBy   | Approver User                   |
      | lastChangedAt   | 2026-04-17T09:15:00Z            |
      | rejectionReason | Duplicate payment; see TXN-0001 |

  Scenario: A rejection shows straight away in the list, the counts and the file's details
    Given these transactions exist:
      | reference | status   | file      |
      | TXN-001   | Imported | april.csv |
      | TXN-002   | Approved | april.csv |
    And I am signed in as "approver@digiata.com"
    When I reject the transaction "TXN-001" with the reason "Wrong account"
    Then the response status code is 200
    When I list the transactions with the query "status=Rejected"
    Then the listed references are "TXN-001"
    When I request the number of imported transactions
    Then the number of imported transactions is 0
    When I request the dashboard summary
    Then the dashboard counts 0 Imported, 1 Approved and 1 Rejected transactions
    When I request the details of the file "april.csv"
    Then the file details are:
      | field                 | value |
      | transactions.imported | 0     |
      | transactions.rejected | 1     |
      | isFullyReviewed       | true  |

  Scenario: Whitespace around the reason is removed before it is stored
    Given these transactions exist:
      | reference |
      | TXN-001   |
    And I am signed in as "approver@digiata.com"
    When I reject the transaction "TXN-001" with the request body '{"reason": "  \t Wrong amount \n "}'
    Then the response status code is 200
    And the transaction details are:
      | field           | value        |
      | rejectionReason | Wrong amount |
    And the transaction "TXN-001" has the stored rejection reason "Wrong amount"

  Scenario Outline: A rejection without a reason is refused
    Given these transactions exist:
      | reference |
      | TXN-001   |
    And I am signed in as "approver@digiata.com"
    When I reject the transaction "TXN-001" with the request body '<body>'
    Then the response status code is 400
    And the validation errors include the field "reason"
    And the transaction "TXN-001" is stored as "Imported", last changed by "System"

    Examples:
      | case             | body                       |
      | missing          | {}                         |
      | null             | {"reason": null}           |
      | empty            | {"reason": ""}             |
      | only spaces      | {"reason": "     "}        |
      | other whitespace | {"reason": " \t\r\\n "}    |

  Scenario: A rejection with an empty request body is refused
    Given these transactions exist:
      | reference |
      | TXN-001   |
    And I am signed in as "approver@digiata.com"
    When I reject the transaction "TXN-001" with the request body ""
    Then the response status code is 400
    And the transaction "TXN-001" is stored as "Imported", last changed by "System"

  Scenario Outline: The reason can be up to 500 characters, counted after trimming
    Given these transactions exist:
      | reference |
      | TXN-001   |
    And I am signed in as "approver@digiata.com"
    When I reject the transaction "TXN-001" with "<text>" repeated <times> times and <padding> spaces on each side as the reason
    Then the response status code is 200
    And the transaction "TXN-001" has a stored rejection reason of <length> characters

    Examples:
      | case                            | text | times | padding | length |
      | one character                   | x    | 1     | 0       | 1      |
      | exactly 500                     | x    | 500   | 0       | 500    |
      | 500 with surrounding spaces     | x    | 500   | 20      | 500    |
      | 250 characters of 2 code units  | 😀   | 250   | 0       | 500    |

  Scenario Outline: A reason longer than 500 characters is refused
    Given these transactions exist:
      | reference |
      | TXN-001   |
    And I am signed in as "approver@digiata.com"
    When I reject the transaction "TXN-001" with "<text>" repeated <times> times and 0 spaces on each side as the reason
    Then the response status code is 400
    And the validation errors include the field "reason"
    And the transaction "TXN-001" is stored as "Imported", last changed by "System"

    Examples:
      | case                            | text | times |
      | 501                             | x    | 501   |
      | 251 characters of 2 code units  | 😀   | 251   |

  Scenario Outline: A transaction that is no longer Imported is not changed
    Given these transactions exist:
      | reference | status   | rejection reason | last changed by | last changed at      |
      | TXN-001   | <status> | <reason>         | Other Approver  | 2026-04-16T12:00:00Z |
    And I am signed in as "approver@digiata.com"
    And the current time is "2026-04-17T09:15:00Z"
    When I reject the transaction "TXN-001" with the reason "Changed my mind"
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
    And the transaction "TXN-001" has the stored rejection reason "<reason>"

    Examples:
      | status   | reason            | message                                     |
      | Approved |                   | This transaction has already been approved. |
      | Rejected | Duplicate payment | This transaction has already been rejected. |

  Scenario: An importer cannot reject a transaction
    Given these transactions exist:
      | reference |
      | TXN-001   |
    And I am signed in as "fileimporter@digiata.com"
    When I reject the transaction "TXN-001" with the reason "Not mine to approve"
    Then the response status code is 403
    And the response message is "You do not have access to this. Please ask your administrator for access."
    And the transaction "TXN-001" is stored as "Imported", last changed by "System"

  Scenario: An unknown transaction is not found
    Given I am signed in as "approver@digiata.com"
    When I reject the transaction with the id "6b9f8f0e-5d7c-4a0f-9a55-1d7f0a6c2b11" with the reason "Unknown"
    Then the response status code is 404
    And the response message is "Transaction not found"

  Scenario: A transaction of a cancelled file is not found and not changed
    Given these files exist:
      | name          | cancelled | imported |
      | cancelled.csv | yes       | 1        |
    And I am signed in as "approver@digiata.com"
    When I reject the first transaction of the file "cancelled.csv" with the reason "Cancelled anyway"
    Then the response status code is 404
    And the response message is "Transaction not found"
    And the file "cancelled.csv" still has 1 Imported, 0 Approved and 0 Rejected transactions

  Scenario: Rejecting a transaction requires a signed-in session
    Given these transactions exist:
      | reference |
      | TXN-001   |
    When I reject the transaction "TXN-001" with the reason "Anonymous"
    Then the response status code is 401
    And the response reason is "NotSignedIn"
    And the transaction "TXN-001" is stored as "Imported", last changed by "System"
