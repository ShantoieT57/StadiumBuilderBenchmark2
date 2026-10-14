Feature: Download the original file
  Any signed-in person can download the original file exactly as it was uploaded (FD-05): the same
  bytes, including any byte-order mark and the original line endings, as a .csv attachment that
  carries the original file name. Cancelling a file discards the app's copy of the original, so it
  can no longer be downloaded (FX-04); the download then answers 410 Gone, unlike an unknown file,
  which is not found (404).

  Scenario Outline: The supplied sample file is downloaded byte for byte
    Given I am signed in as "fileimporter@digiata.com"
    And I have uploaded the sample file "transactions_2026-04-15.csv"
    And the file processor has processed the waiting files
    And I am signed in as "<email>"
    When I download the last uploaded file
    Then the response status code is 200
    And the response content type is "text/csv"
    And the downloaded bytes are exactly the bytes of the sample file "transactions_2026-04-15.csv"
    And the download is an attachment named "transactions_2026-04-15.csv"

    Examples:
      | email                    |
      | fileimporter@digiata.com |
      | approver@digiata.com     |

  Scenario: A byte-order mark, mixed line endings and non-ASCII characters are kept
    Given I am signed in as "fileimporter@digiata.com"
    And I have uploaded the sample file "transactions_2026-04-15.csv" with a UTF-8 byte-order mark, a line feed ending and a café row
    When I download the last uploaded file
    Then the response status code is 200
    And the downloaded bytes are exactly the bytes that were uploaded

  Scenario: A file that is waiting for corrections can still be downloaded
    Given I am signed in as "fileimporter@digiata.com"
    And I have uploaded a file named "broken.csv" with the rows:
      | Reference | TransactionDate  | AccountNumber | Description | Amount | TransactionType | Currency |
      | TXN-1     | 2026/04/15 08:12 | 1001          | Bad type    | 10     | X               | ZAR      |
    And the file processor has processed the waiting files
    When I download the last uploaded file
    Then the response status code is 200
    And the downloaded bytes are exactly the bytes that were uploaded
    And the download is an attachment named "broken.csv"

  Scenario Outline: The original file name is encoded safely
    Given a file named "<name>" exists with the content of the sample file "transactions_2026-04-15.csv"
    And I am signed in as "approver@digiata.com"
    When I download the file "<name>"
    Then the response status code is 200
    And the download is an attachment named "<name>"
    And the downloaded bytes are exactly the bytes of the sample file "transactions_2026-04-15.csv"

    Examples:
      | case               | name                          |
      | spaces             | transactions april 2026.csv   |
      | accented letters   | transações_2026-04-15.csv     |
      | punctuation        | april's report, final;v2 (100%).csv |
      | non-Latin letters  | 取引_2026.csv                  |

  Scenario: A cancelled file can no longer be downloaded
    Given I am signed in as "fileimporter@digiata.com"
    And I have uploaded the sample file "transactions_2026-04-15.csv"
    And the file processor has processed the waiting files
    And uploaded file 1 has been cancelled
    When I download the last uploaded file
    Then the response status code is 410
    And the response message is "The original file is no longer available because the file has been cancelled."

  Scenario: A file whose original content has been discarded can no longer be downloaded
    Given I am signed in as "fileimporter@digiata.com"
    And I have uploaded the sample file "transactions_2026-04-15.csv"
    And the original content of uploaded file 1 has been discarded
    When I download the last uploaded file
    Then the response status code is 410
    And the response message is "The original file is no longer available because the file has been cancelled."

  Scenario: An unknown file is not found
    Given I am signed in as "fileimporter@digiata.com"
    When I download a file that does not exist
    Then the response status code is 404
    And the response message is "File not found"

  Scenario: Downloading requires a signed-in session
    Given these files exist:
      | name     |
      | file.csv |
    When I download the file "file.csv"
    Then the response status code is 401
    And the response reason is "NotSignedIn"
