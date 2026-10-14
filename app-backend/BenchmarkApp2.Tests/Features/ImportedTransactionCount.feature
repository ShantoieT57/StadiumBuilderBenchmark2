Feature: Imported transaction count
  For approvers, the Transactions menu item shows how many transactions are still Imported (TL-07).
  The raw number is returned; showing "99+" and hiding zero is up to the front-end. Transactions of
  cancelled files never count. Importers are refused.

  Scenario: The count is the number of transactions still Imported in files that are not cancelled
    Given these files exist:
      | name          | imported | approved | rejected | cancelled |
      | april.csv     | 3        | 2        | 1        | no        |
      | may.csv       | 4        | 0        | 0        | no        |
      | cancelled.csv | 5        | 0        | 0        | yes       |
    And I am signed in as "approver@digiata.com"
    When I request the number of imported transactions
    Then the response status code is 200
    And the number of imported transactions is 7

  Scenario: The count is zero when nothing is still Imported
    Given these files exist:
      | name      | approved | rejected |
      | april.csv | 2        | 1        |
    And I am signed in as "approver@digiata.com"
    When I request the number of imported transactions
    Then the response status code is 200
    And the number of imported transactions is 0

  Scenario: The exact count is returned above 99
    Given these files exist:
      | name      | imported |
      | april.csv | 120      |
    And I am signed in as "approver@digiata.com"
    When I request the number of imported transactions
    Then the response status code is 200
    And the number of imported transactions is 120

  Scenario: An importer cannot request the count
    Given I am signed in as "fileimporter@digiata.com"
    When I request the number of imported transactions
    Then the response status code is 403
    And the response message is "You do not have access to this. Please ask your administrator for access."

  Scenario: Requesting the count requires a signed-in session
    When I request the number of imported transactions
    Then the response status code is 401
    And the response reason is "NotSignedIn"
