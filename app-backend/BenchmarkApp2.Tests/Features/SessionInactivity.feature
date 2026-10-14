Feature: Session inactivity timeout
  A person who has done nothing in the app for the inactivity timeout (60 minutes by default) is
  signed out and returned to the sign-in screen (SI-06). Any authenticated request counts as
  activity and resets the timeout. The current-user endpoint is used as the authenticated request.

  Scenario: A session used within the timeout stays active
    Given I am signed in as "fileimporter@digiata.com"
    When 59 minutes pass
    And I request the current user
    Then the response status code is 200

  Scenario: A session expires after 60 minutes of inactivity
    Given I am signed in as "fileimporter@digiata.com"
    When 60 minutes pass
    And I request the current user
    Then the response status code is 401
    And the response reason is "SessionExpired"
    And the response message is "Your session has expired after 60 minutes of inactivity. Please sign in again."
    And my session has ended with the reason "Expired"

  Scenario: Any activity resets the inactivity timeout
    Given I am signed in as "approver@digiata.com"
    When 59 minutes pass
    And I request the current user
    And 59 minutes pass
    And I request the current user
    Then the response status code is 200

  Scenario: An expired session stays expired
    Given I am signed in as "approver@digiata.com"
    When 61 minutes pass
    And I request the current user
    And I request the current user
    Then the response status code is 401
    And the response reason is "SessionExpired"

  Scenario: The inactivity timeout is a setting
    Given the session inactivity timeout is set to 15 minutes
    And I am signed in as "approver@digiata.com"
    When 14 minutes pass
    And I request the current user
    Then the response status code is 200
    When 15 minutes pass
    And I request the current user
    Then the response status code is 401
    And the response reason is "SessionExpired"
    And the response message is "Your session has expired after 15 minutes of inactivity. Please sign in again."
