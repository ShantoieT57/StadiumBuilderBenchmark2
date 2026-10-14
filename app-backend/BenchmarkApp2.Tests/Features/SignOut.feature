Feature: Sign out
  A person can sign out at any time. Signing out ends their sign-in on every device (SI-08):
  every active session of that person ends, and those session cookies no longer authenticate.

  Scenario: Signing out ends the session
    Given I am signed in as "approver@digiata.com"
    When I sign out
    Then the response status code is 204
    And the session cookie is cleared
    When I request the current user
    Then the response status code is 401

  Scenario: Signing out without a session still succeeds
    When I sign out
    Then the response status code is 204
    And the session cookie is cleared

  Scenario: Signing out ends the person's sign-in on every device
    Given I am signed in as "approver@digiata.com" in browser "A"
    And "approver@digiata.com" also has an active session in browser "B"
    When I sign out in browser "A"
    Then the response status code is 204
    When I request the current user from browser "B"
    Then the response status code is 401
    And the response reason is "SignedOut"
    And the response message is "You have been signed out. Please sign in again."
    And the session in browser "A" has ended with the reason "SignedOut"
    And the session in browser "B" has ended with the reason "SignedOut"

  Scenario: Signing out does not affect another person's session
    Given I am signed in as "approver@digiata.com" in browser "A"
    And I am signed in as "fileimporter@digiata.com" in browser "B"
    When I sign out in browser "A"
    And I request the current user from browser "B"
    Then the response status code is 200

  Scenario: Signing out with a session that has already ended does not sign the person out elsewhere
    Given I am signed in as "approver@digiata.com" in browser "A"
    And I am signed in as "approver@digiata.com" in browser "B"
    When I sign out in browser "A"
    And I request the current user from browser "B"
    Then the response status code is 200
