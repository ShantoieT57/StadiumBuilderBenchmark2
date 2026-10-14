Feature: Live change notifications
  GET /events is a Server-Sent Events stream that tells the front-end when something changed, so the
  dashboard, a file's details and the approvals badge update without refreshing (UP-07, DB-01, FD-01,
  TL-07). Events are hints to re-fetch, not data: "file-changed" carries a file's id, status and
  whether it is cancelled; "transactions-changed" carries the id of the file whose transactions
  changed. The events come from the database once a change has committed, so changes made by any
  instance of the app are announced. Both roles see every event.

  Keeping the stream open does not count as activity (SI-06). The session is checked at every
  heartbeat, and once it has expired, been replaced by a sign-in elsewhere (SI-07) or been signed out
  (SI-08) the stream sends a final "session-ended" event with the same reason a 401 gives, and closes.

  Each client has a buffer of 256 events; a client that falls that far behind is disconnected so it
  never holds up the others.

  Background:
    Given the event stream sends a heartbeat every 1 second

  Scenario: An anonymous caller is refused before the stream opens
    When I open the event stream
    Then the response status code is 401
    And the response reason is "NotSignedIn"

  Scenario Outline: Both roles can open the event stream
    Given I am signed in as "<email>"
    When I open the event stream
    Then the event stream is open with the content type "text/event-stream"

    Examples:
      | email                    |
      | fileimporter@digiata.com |
      | approver@digiata.com     |

  Scenario: Heartbeats are sent while the stream is open
    Given I am signed in as "approver@digiata.com"
    When I open the event stream
    Then the event stream receives 2 more heartbeats

  Scenario: An upload is followed through processing to Completed
    Given I am signed in as "fileimporter@digiata.com"
    And I have opened the event stream
    When I upload the sample file "transactions_2026-04-15.csv"
    And the file processor processes the waiting files
    Then the event stream receives these file-changed events for the last uploaded file:
      | status     | isCancelled |
      | Uploaded   | false       |
      | Processing | false       |
      | Completed  | false       |
    And the event stream receives a transactions-changed event for the last uploaded file
    And the ids of the events received by the event stream increase

  Scenario: A file that fails for invalid rows is announced as Failed
    Given I am signed in as "fileimporter@digiata.com"
    And I have opened the event stream
    When I upload a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad amount  | ten    | C               | ZAR      |
    And the file processor processes the waiting files
    Then the event stream receives these file-changed events for the last uploaded file:
      | status     | isCancelled |
      | Uploaded   | false       |
      | Processing | false       |
      | Failed     | false       |

  Scenario: A re-check that loads the file announces the file and its transactions
    Given I am signed in as "fileimporter@digiata.com"
    And I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad amount  | ten    | C               | ZAR      |
    And the file processor has processed the waiting files
    And I have opened the event stream
    When I re-check the last uploaded file with the corrections:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          | Fixed       | 10     | C               | ZAR      |
    Then the response status code is 200
    And the event stream receives these file-changed events for the last uploaded file:
      | status    | isCancelled |
      | Completed | false       |
    And the event stream receives a transactions-changed event for the last uploaded file

  Scenario: A re-check that still finds invalid rows is announced
    Given I am signed in as "fileimporter@digiata.com"
    And I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad amount  | ten    | C               | ZAR      |
    And the file processor has processed the waiting files
    And I have opened the event stream
    When I re-check the last uploaded file without corrections
    Then the response status code is 200
    And the event stream receives these file-changed events for the last uploaded file:
      | status | isCancelled |
      | Failed | false       |

  Scenario: Approving a transaction announces that the file's transactions changed
    Given these transactions exist:
      | reference | status   | file      |
      | TXN-001   | Imported | april.csv |
    And I am signed in as "approver@digiata.com"
    And I have opened the event stream
    When I approve the transaction "TXN-001"
    Then the response status code is 200
    And the event stream receives a transactions-changed event for the file "april.csv"

  Scenario: Rejecting a transaction announces that the file's transactions changed
    Given these transactions exist:
      | reference | status   | file      |
      | TXN-001   | Imported | april.csv |
    And I am signed in as "approver@digiata.com"
    And I have opened the event stream
    When I reject the transaction "TXN-001" with the reason "Wrong account"
    Then the response status code is 200
    And the event stream receives a transactions-changed event for the file "april.csv"

  Scenario: Cancelling a file announces the file and its transactions
    Given I am signed in as "fileimporter@digiata.com"
    And I have uploaded the sample file "transactions_2026-04-15.csv"
    And the file processor has processed the waiting files
    And I have opened the event stream
    When I cancel the last uploaded file
    Then the response status code is 200
    And the event stream receives these file-changed events for the last uploaded file:
      | status    | isCancelled |
      | Completed | true        |
    And the event stream receives a transactions-changed event for the last uploaded file

  Scenario: Every connected client receives every event, whatever its role
    Given I am signed in as "fileimporter@digiata.com"
    And I am signed in as "approver@digiata.com" in browser "B"
    And I have opened the event stream
    And I have opened the event stream in browser "B"
    When I upload the sample file "transactions_2026-04-15.csv"
    Then the event stream receives these file-changed events for the last uploaded file:
      | status   | isCancelled |
      | Uploaded | false       |
    And the event stream in browser "B" receives these file-changed events for the last uploaded file:
      | status   | isCancelled |
      | Uploaded | false       |

  Scenario: Neither opening nor keeping the stream open counts as activity, so the session still expires
    Given I am signed in as "fileimporter@digiata.com"
    And 30 minutes pass
    And I have opened the event stream
    When 29 minutes pass
    Then the event stream receives 2 more heartbeats
    When 1 minutes pass
    Then the event stream ends with a session-ended event with the reason "SessionExpired" and the message "Your session has expired after 60 minutes of inactivity. Please sign in again."
    And my session has ended with the reason "Expired"

  Scenario: Signing in elsewhere ends the stream
    Given I am signed in as "approver@digiata.com" in browser "A"
    And I have opened the event stream in browser "A"
    When I sign in as "approver@digiata.com" in browser "B"
    Then the event stream in browser "A" ends with a session-ended event with the reason "SignedInElsewhere" and the message "You have been signed out because you signed in somewhere else."

  Scenario: Signing out ends the stream
    Given I am signed in as "approver@digiata.com"
    And I have opened the event stream
    When I sign out
    Then the event stream ends with a session-ended event with the reason "SignedOut" and the message "You have been signed out. Please sign in again."

  Scenario: A client that disconnects is removed
    Given I am signed in as "approver@digiata.com"
    And I have opened the event stream
    And 1 client is connected to the event stream
    When I close the event stream
    Then soon no client is connected to the event stream

  Scenario: Stopping the host closes the streams
    Given I am signed in as "approver@digiata.com"
    And I have opened the event stream
    When the TransactionApi host stops
    Then the event stream ends without a session-ended event

  Scenario: A client that falls too far behind is disconnected without holding up the others
    Given I am signed in as "approver@digiata.com"
    And I have opened the event stream
    And a client that never reads its events is connected
    When 4 batches of 64 changes are announced, each received by the event stream before the next
    Then the client that never reads its events is still connected
    When 1 more change is announced
    Then the client that never reads its events has been disconnected
    And the event stream receives that change

  Scenario: The stream recovers when the database connection drops
    Given I am signed in as "fileimporter@digiata.com"
    And I have opened the event stream
    When the change listener's database connection drops
    Then the event stream receives a resync event
    When I upload the sample file "transactions_2026-04-15.csv"
    Then the event stream receives these file-changed events for the last uploaded file:
      | status   | isCancelled |
      | Uploaded | false       |
