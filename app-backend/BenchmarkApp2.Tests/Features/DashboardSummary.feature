Feature: Dashboard summary
  Above the file list, the dashboard shows how many files are in each status, and how many
  transactions are Imported, Approved and Rejected, across all files that are not cancelled
  (DB-01). Both roles see the dashboard.

  Scenario Outline: Files and transactions are counted by status
    Given these files exist:
      | name         | status     | rows | imported | approved | rejected |
      | waiting.csv  | Uploaded   |      | 0        | 0        | 0        |
      | checking.csv | Processing | 4    | 0        | 0        | 0        |
      | april.csv    | Completed  | 6    | 3        | 2        | 1        |
      | may.csv      | Completed  | 5    | 2        | 0        | 3        |
      | broken.csv   | Failed     | 3    | 0        | 0        | 0        |
    And I am signed in as "<email>"
    When I request the dashboard summary
    Then the response status code is 200
    And the dashboard counts 1 Uploaded, 1 Processing, 2 Completed and 1 Failed files
    And the dashboard counts 5 Imported, 2 Approved and 4 Rejected transactions

    Examples:
      | email                    |
      | fileimporter@digiata.com |
      | approver@digiata.com     |

  Scenario: Cancelled files and their transactions are not counted
    Given these files exist:
      | name          | status    | rows | imported | approved | rejected | cancelled |
      | april.csv     | Completed | 6    | 3        | 2        | 1        | no        |
      | cancelled.csv | Completed | 9    | 4        | 3        | 2        | yes       |
      | dropped.csv   | Failed    | 2    | 0        | 0        | 0        | yes       |
    And I am signed in as "approver@digiata.com"
    When I request the dashboard summary
    Then the response status code is 200
    And the dashboard counts 0 Uploaded, 0 Processing, 1 Completed and 0 Failed files
    And the dashboard counts 3 Imported, 2 Approved and 1 Rejected transactions

  Scenario: Every count is zero when there are no files
    Given I am signed in as "fileimporter@digiata.com"
    When I request the dashboard summary
    Then the response status code is 200
    And the dashboard counts 0 Uploaded, 0 Processing, 0 Completed and 0 Failed files
    And the dashboard counts 0 Imported, 0 Approved and 0 Rejected transactions

  Scenario: The dashboard summary requires a signed-in session
    When I request the dashboard summary
    Then the response status code is 401
    And the response reason is "NotSignedIn"
