Feature: Current user
  The person signed in with the current session can be identified, so the app can always show
  who is signed in (SI-09) and land them on the screen for their role (SI-05).
  Every endpoint other than sign-in and sign-out requires a signed-in session (AC-03).

  Scenario Outline: A signed-in person retrieves their own details
    Given I am signed in as "<email>"
    When I request the current user
    Then the response status code is 200
    And the response describes the user "<name>" with email "<email>" and role "<role>"

    Examples:
      | name          | email                    | role     |
      | File Importer | fileimporter@digiata.com | Importer |
      | Approver User | approver@digiata.com     | Approver |

  Scenario: Without a session the current user is not available
    When I request the current user
    Then the response status code is 401

  Scenario: A session cookie that was never issued is not accepted
    Given I have a session cookie that was never issued
    When I request the current user
    Then the response status code is 401
