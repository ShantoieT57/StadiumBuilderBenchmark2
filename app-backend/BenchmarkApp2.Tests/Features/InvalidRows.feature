Feature: Invalid rows of a file waiting for corrections
  For a file that failed because of invalid rows, the importer sees only the invalid rows, with
  every column exactly as it was in the file and every reason each row failed (FC-01, FP-04), and
  how many invalid rows remain. Each row has a stable id, used to correct it. Only importers correct
  files, so an approver is refused. A file that is not waiting for corrections (not failed because
  of invalid rows, or cancelled, FX-04) is refused with 409.

  Scenario: Only the invalid rows are listed, with their original values and every reason
    Given I am signed in as "fileimporter@digiata.com"
    And I have uploaded a file named "broken.csv" with the content:
      """
      Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency
      TXN-1,2026/04/15 08:12,1001,Valid,10,C,ZAR
      TXN-2,not a date,,"Refund, ""urgent""",-5,X,ZAR
      ,2026/04/15 08:12,1001,Ignored,abc,Q,ZAR
      TXN-4,2026/04/15 08:12,1001,Valid too,20.5,D,ZAR
      TXN-5,2026/04/15 08:12,1001, Spaces kept ,1.234,D,usd
      """
    And the file processor has processed the waiting files
    When I request the invalid rows of the last uploaded file
    Then the response status code is 200
    And the invalid rows are:
      | Row | Reference | TransactionDate  | AccountNumber | Description       | Amount | TransactionType | Currency | Reasons                                                                            |
      | 2   | TXN-2     | not a date       |               | Refund, "urgent"  | -5     | X               | ZAR      | Invalid Transaction Type; Invalid Transaction Date; Invalid Amount; Missing Account Number |
      | 5   | TXN-5     | 2026/04/15 08:12 | 1001          | ' Spaces kept '   | 1.234  | D               | usd      | Invalid Amount                                                                     |
    And the number of invalid rows remaining is 2
    And every invalid row has a different id
    When I request the invalid rows of the last uploaded file again
    Then the invalid rows have the same ids as before

  Scenario: A row with the wrong number of columns is listed with its missing columns empty
    Given I am signed in as "fileimporter@digiata.com"
    And I have uploaded a file named "short.csv" with the content:
      """
      Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency
      TXN-1,2026/04/15 08:12,1001
      """
    And the file processor has processed the waiting files
    When I request the invalid rows of the last uploaded file
    Then the response status code is 200
    And the invalid rows are:
      | Row | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency | Reasons                                                          |
      | 1   | TXN-1     | 2026/04/15 08:12 | 1001          |             |        |                 |          | Wrong Number Of Columns; Invalid Transaction Type; Invalid Amount |
    And the number of invalid rows remaining is 1

  Scenario: An approver cannot see the correction screen
    Given I am signed in as "fileimporter@digiata.com"
    And I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad type    | 10     | X               | ZAR      |
    And the file processor has processed the waiting files
    And I am signed in as "approver@digiata.com"
    When I request the invalid rows of the last uploaded file
    Then the response status code is 403
    And the response message is "You do not have access to this. Please ask your administrator for access."

  Scenario Outline: A file that is not waiting for corrections is refused
    Given these files exist:
      | name     | status   | failure kind | cancelled   |
      | file.csv | <status> | <kind>       | <cancelled> |
    And I am signed in as "fileimporter@digiata.com"
    When I request the invalid rows of the file "file.csv"
    Then the response status code is 409
    And the response message is "This file is not waiting for corrections."

    Examples:
      | case                         | status     | kind        | cancelled |
      | waiting to be processed      | Uploaded   |             | no        |
      | being processed              | Processing |             | no        |
      | completed                    | Completed  |             | no        |
      | failed as a duplicate        | Failed     | Duplicate   | no        |
      | cancelled with invalid rows  | Failed     | InvalidRows | yes       |

  Scenario: An unknown file is not found
    Given I am signed in as "fileimporter@digiata.com"
    When I request the invalid rows of a file that does not exist
    Then the response status code is 404
    And the response message is "File not found"

  Scenario: The invalid rows require a signed-in session
    Given these files exist:
      | name     | status | failure kind |
      | file.csv | Failed | InvalidRows  |
    When I request the invalid rows of the file "file.csv"
    Then the response status code is 401
    And the response reason is "NotSignedIn"
