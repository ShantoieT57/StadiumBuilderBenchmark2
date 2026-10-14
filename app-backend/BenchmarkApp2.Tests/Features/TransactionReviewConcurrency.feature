Feature: Approving and rejecting at the same moment
  Approved and Rejected are final (TS-02, TS-03, TS-04), so when two approvers act on the same
  transaction at the same moment it changes exactly once, and the other approver is told its current
  status (AP-04, RJ-05). An approval and a cancel of the transaction's file never overlap: there is
  never an Approved transaction on a cancelled file, and a cancel never removes an Approved
  transaction (FX-02).
  Another database session holds rows locked so that requests can be lined up behind it and then
  let go together, or in a chosen order.

  Background:
    Given another approver "Second Approver" with the email "second.approver@digiata.com" exists
    And these transactions exist:
      | reference | status   | file      |
      | TXN-001   | Imported | april.csv |
    And I am signed in as "approver@digiata.com" in browser "first"
    And I am signed in as "second.approver@digiata.com" in browser "second"
    And I am signed in as "fileimporter@digiata.com" in browser "importer"

  Scenario: Two approvals at the same moment change the transaction once
    Given another database session holds the transaction "TXN-001" locked
    When browser "first" starts approving the transaction "TXN-001"
    And browser "second" starts approving the transaction "TXN-001"
    And 2 requests are waiting for the lock
    And the other database session releases its locks
    Then one of the requests in browsers "first" and "second" succeeds and the other is refused with 409
    And the refused request says "This transaction has already been approved." and shows the transaction as "Approved"
    And the transaction "TXN-001" is stored as "Approved", last changed by the approver whose request succeeded

  Scenario: An approval and a rejection at the same moment change the transaction once
    Given another database session holds the transaction "TXN-001" locked
    When browser "first" starts approving the transaction "TXN-001"
    And browser "second" starts rejecting the transaction "TXN-001" with the reason "Looks wrong"
    And 2 requests are waiting for the lock
    And the other database session releases its locks
    Then one of the requests in browsers "first" and "second" succeeds and the other is refused with 409
    And the refused request shows the transaction with the status of the request that succeeded
    And the transaction "TXN-001" is stored with the outcome of the request that succeeded

  Scenario: An approval and a cancel racing on the same file leave a consistent state
    Given another database session holds the file "april.csv" locked
    When browser "first" starts approving the transaction "TXN-001"
    And browser "importer" starts cancelling the file "april.csv"
    And 2 requests are waiting for the lock
    And the other database session releases its locks
    Then either the approval stands and the cancel of "april.csv" is refused, or the cancel succeeds and the approval is not found
    And no cancelled file has an approved transaction

  Scenario: A cancel waits for an approval under way and is then refused
    Given another database session holds the transaction "TXN-001" locked
    When browser "first" starts approving the transaction "TXN-001"
    And 1 request is waiting for the lock
    And browser "importer" starts cancelling the file "april.csv"
    And 2 requests are waiting for the lock
    And the other database session releases its locks
    Then the request in browser "first" finishes with the response status code 200
    And the request in browser "importer" finishes with the response status code 409
    And the response message is "This file cannot be cancelled because 1 of its transactions has been approved."
    And the transaction "TXN-001" is stored as "Approved", last changed by "Approver User"
    And the file "april.csv" is not cancelled

  Scenario: An approval waits for a cancel under way and then finds the transaction gone
    Given another database session holds the transaction "TXN-001" locked
    When browser "importer" starts cancelling the file "april.csv"
    And 1 request is waiting for the lock
    And browser "first" starts approving the transaction "TXN-001"
    And 2 requests are waiting for the lock
    And the other database session releases its locks
    Then the request in browser "importer" finishes with the response status code 200
    And the request in browser "first" finishes with the response status code 404
    And the response message is "Transaction not found"
    And the file "april.csv" has no transactions left
    And no cancelled file has an approved transaction
