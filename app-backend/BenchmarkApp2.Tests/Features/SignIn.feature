Feature: Sign in
  A person signs in with their email address and password (SI-01, SI-02).
  A successful sign-in starts a server-side session that is held in an HttpOnly cookie.

  Scenario Outline: A seeded person signs in with valid credentials
    When I sign in with email "<email>" and password "Test123"
    Then the response status code is 200
    And the response describes the user "<name>" with email "<email>" and role "<role>"
    And an HttpOnly session cookie is issued

    Examples:
      | name          | email                    | role     |
      | File Importer | fileimporter@digiata.com | Importer |
      | Approver User | approver@digiata.com     | Approver |

  Scenario: The email address is matched regardless of upper and lower case
    When I sign in with email "FileImporter@Digiata.COM" and password "Test123"
    Then the response status code is 200
    And the response describes the user "File Importer" with email "fileimporter@digiata.com" and role "Importer"
    And an HttpOnly session cookie is issued

  Scenario Outline: A wrong email address or password is refused without saying which was wrong
    When I sign in with email "<email>" and password "<password>"
    Then the response status code is 401
    And the response message is "Invalid email or password"
    And no session cookie is issued

    Examples:
      | case                     | email                    | password |
      | unknown email address    | nobody@digiata.com       | Test123  |
      | wrong password           | fileimporter@digiata.com | Wrong123 |
      | password in the wrong case | approver@digiata.com   | test123  |

  Scenario Outline: The email address and the password are both required
    When I sign in with email "<email>" and password "<password>"
    Then the response status code is 400
    And the validation errors include the field "<field>"
    And no session cookie is issued

    Examples:
      | email                    | password | field    |
      |                          | Test123  | email    |
      | fileimporter@digiata.com |          | password |

  Scenario: A sign-in request without any credentials is refused
    When I sign in without supplying an email address or password
    Then the response status code is 400
    And the validation errors include the field "email"
    And the validation errors include the field "password"
    And no session cookie is issued

  Scenario: Signing in in a second browser signs the person out of the first
    Given I am signed in as "fileimporter@digiata.com" in browser "A"
    When I sign in as "fileimporter@digiata.com" in browser "B"
    And I request the current user from browser "A"
    Then the response status code is 401
    And the response reason is "SignedInElsewhere"
    And the response message is "You have been signed out because you signed in somewhere else."
    And the session in browser "A" has ended with the reason "SignedInElsewhere"
    When I request the current user from browser "B"
    Then the response status code is 200

  Scenario: Signing in does not affect another person's session
    Given I am signed in as "fileimporter@digiata.com" in browser "A"
    When I sign in as "approver@digiata.com" in browser "B"
    And I request the current user from browser "A"
    Then the response status code is 200

  Scenario: A failed sign-in does not sign the person out elsewhere
    Given I am signed in as "fileimporter@digiata.com" in browser "A"
    When I sign in with email "fileimporter@digiata.com" and password "Wrong123"
    And I request the current user from browser "A"
    Then the response status code is 200

  Scenario: A session that had already timed out is recorded as expired when the person signs in again
    Given I am signed in as "fileimporter@digiata.com" in browser "A"
    When 60 minutes pass
    And I sign in as "fileimporter@digiata.com" in browser "B"
    Then the session in browser "A" has ended with the reason "Expired"
