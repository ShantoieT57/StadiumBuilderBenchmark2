Feature: Sign out
  A person can sign out at any time. Signing out ends the session, and the session cookie
  no longer authenticates afterwards.

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
