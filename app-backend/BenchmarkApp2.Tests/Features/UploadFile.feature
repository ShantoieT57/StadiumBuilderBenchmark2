Feature: Upload a file
  An importer uploads a transaction file and chooses what kind of file it is (UP-02). Only .csv
  files with a valid name are accepted (UP-03, UP-04). An upload only hands the file over (UP-07):
  the exact original file is kept with the status Uploaded, and it is checked and loaded later.
  Only importers may upload (AC-03). The request must be multipart/form-data with exactly one file
  in the field "file"; a part sent with an empty file name is a file without a name. A malformed or
  oversized request is always refused with a JSON message, never with a server error.

  Scenario: An importer uploads the supplied sample file
    Given I am signed in as "fileimporter@digiata.com"
    When I upload the sample file "transactions_2026-04-15.csv" as the kind "BankTransactions"
    Then the response status code is 201
    And the response describes the uploaded file "transactions_2026-04-15.csv" of kind "BankTransactions" with status "Uploaded"
    And the response upload time is the current time
    And exactly one file has been stored
    And the stored file is the uploaded file "transactions_2026-04-15.csv" of kind "BankTransactions" with status "Uploaded"
    And the stored file has exactly the bytes of the uploaded file
    And the stored file has the SHA-256 hash of the uploaded file
    And the stored file was uploaded by "fileimporter@digiata.com" at the current time

  Scenario: The file kind defaults to bank transactions
    Given I am signed in as "fileimporter@digiata.com"
    When I upload the sample file "transactions_2026-04-15.csv" without choosing a kind
    Then the response status code is 201
    And the response describes the uploaded file "transactions_2026-04-15.csv" of kind "BankTransactions" with status "Uploaded"
    And the stored file is the uploaded file "transactions_2026-04-15.csv" of kind "BankTransactions" with status "Uploaded"

  Scenario: An unknown file kind is refused
    Given I am signed in as "fileimporter@digiata.com"
    When I upload a file named "transactions.csv" as the kind "Payroll"
    Then the response status code is 400
    And the validation errors include the field "kind"
    And no file has been stored

  Scenario: A request without a file is refused
    Given I am signed in as "fileimporter@digiata.com"
    When I send an upload request without a file
    Then the response status code is 400
    And the validation errors include the field "file"
    And no file has been stored

  Scenario Outline: The .csv extension is accepted regardless of upper and lower case
    Given I am signed in as "fileimporter@digiata.com"
    When I upload a file named "<file name>"
    Then the response status code is 201
    And the stored file is the uploaded file "<file name>" of kind "BankTransactions" with status "Uploaded"

    Examples:
      | file name        |
      | transactions.csv |
      | transactions.CSV |
      | transactions.Csv |

  Scenario Outline: A file that is not a .csv file is refused
    Given I am signed in as "fileimporter@digiata.com"
    When I upload a file named "<file name>"
    Then the response status code is 400
    And the response message is "Only .csv files can be uploaded. Please choose a .csv file."
    And no file has been stored

    Examples:
      | file name            |
      | transactions.txt     |
      | transactions.xlsx    |
      | transactions.csv.txt |
      | transactions         |
      | transactions.csvx    |

  Scenario Outline: A file with an invalid name is refused
    Given I am signed in as "fileimporter@digiata.com"
    When I upload a file named "<file name>"
    Then the response status code is 400
    And the response message is "Invalid file name"
    And no file has been stored

    Examples:
      | case                        | file name                |
      | parent folder               | ../transactions.csv      |
      | two dots in the name        | transactions..april.csv  |
      | backslash                   | folder\\transactions.csv |
      | forward slash               | folder/transactions.csv  |
      | colon                       | C:transactions.csv       |
      | invalid name and wrong type | ../transactions.txt      |

  Scenario: A file without a name is refused
    Given I am signed in as "fileimporter@digiata.com"
    When I upload a file named ""
    Then the response status code is 400
    And the response message is "Invalid file name"
    And no file has been stored

  Scenario: A file name of 255 characters is accepted
    Given I am signed in as "fileimporter@digiata.com"
    When I upload a .csv file whose name is 255 characters long
    Then the response status code is 201

  Scenario: A file name longer than 255 characters is refused
    Given I am signed in as "fileimporter@digiata.com"
    When I upload a .csv file whose name is 256 characters long
    Then the response status code is 400
    And the response message is "Invalid file name"
    And no file has been stored

  Scenario: A file of exactly the maximum upload size is accepted
    Given the maximum upload size is 1024 bytes
    And I am signed in as "fileimporter@digiata.com"
    When I upload a .csv file of 1024 bytes
    Then the response status code is 201

  Scenario: A file larger than the maximum upload size is refused
    Given the maximum upload size is 1024 bytes
    And I am signed in as "fileimporter@digiata.com"
    When I upload a .csv file of 1025 bytes
    Then the response status code is 413
    And the response message is "The file is too large. Files can be up to 1 KB."
    And no file has been stored

  Scenario: An approver may not upload a file
    Given I am signed in as "approver@digiata.com"
    When I upload the sample file "transactions_2026-04-15.csv" as the kind "BankTransactions"
    Then the response status code is 403
    And the response message is "You do not have access to this. Please ask your administrator for access."
    And no file has been stored

  Scenario: Uploading a file requires a signed-in session
    When I upload the sample file "transactions_2026-04-15.csv" as the kind "BankTransactions"
    Then the response status code is 401
    And the response reason is "NotSignedIn"
    And no file has been stored

  Scenario: A large file without a name is refused as an invalid file name
    Given I am signed in as "fileimporter@digiata.com"
    When I upload a file named "" of 5242880 bytes
    Then the response status code is 400
    And the response message is "Invalid file name"
    And no file has been stored

  Scenario: A file without a name of exactly the maximum upload size is refused as an invalid file name
    Given the maximum upload size is 1024 bytes
    And I am signed in as "fileimporter@digiata.com"
    When I upload a file named "" of 1024 bytes
    Then the response status code is 400
    And the response message is "Invalid file name"
    And no file has been stored

  Scenario: A file without a name that is larger than the maximum upload size is refused as too large
    Given the maximum upload size is 1024 bytes
    And I am signed in as "fileimporter@digiata.com"
    When I upload a file named "" of 1025 bytes
    Then the response status code is 413
    And the response message is "The file is too large. Files can be up to 1 KB."
    And no file has been stored

  Scenario: A file without a name that is larger than the default maximum upload size is refused as too large
    Given I am signed in as "fileimporter@digiata.com"
    When I upload a file named "" of 10485761 bytes
    Then the response status code is 413
    And the response message is "The file is too large. Files can be up to 10 MB."
    And no file has been stored

  Scenario: A plain form field named file is refused as a file without a name
    Given I am signed in as "fileimporter@digiata.com"
    When I send an upload request with a plain form field "file" of 100 bytes
    Then the response status code is 400
    And the response message is "Invalid file name"
    And no file has been stored

  Scenario Outline: Two files in one request are refused
    Given I am signed in as "fileimporter@digiata.com"
    When I upload the files "first.csv" in the field "<first field>" and "second.csv" in the field "<second field>" in one request
    Then the response status code is 400
    And the response message is "Upload one file at a time."
    And no file has been stored

    Examples:
      | first field | second field |
      | file        | file         |
      | file        | attachment   |

  Scenario: Two files are refused even when one of them has no name
    Given I am signed in as "fileimporter@digiata.com"
    When I upload the files "first.csv" in the field "file" and "" in the field "file" in one request
    Then the response status code is 400
    And the response message is "Upload one file at a time."
    And no file has been stored

  Scenario: A file sent under another field name is refused as missing
    Given I am signed in as "fileimporter@digiata.com"
    When I upload the file "transactions.csv" in the field "attachment"
    Then the response status code is 400
    And the validation errors include the field "file"
    And no file has been stored

  Scenario Outline: An upload request that is not multipart form data is refused
    Given I am signed in as "fileimporter@digiata.com"
    When I send an upload request with the content type "<content type>"
    Then the response status code is 415
    And the response message is "Files must be uploaded as multipart/form-data."
    And no file has been stored

    Examples:
      | content type                      |
      | application/json                  |
      | application/x-www-form-urlencoded |
      | text/csv                          |

  Scenario: An upload request without a content type is refused
    Given I am signed in as "fileimporter@digiata.com"
    When I send an upload request without a content type
    Then the response status code is 415
    And the response message is "Files must be uploaded as multipart/form-data."
    And no file has been stored

  Scenario: An upload request without a multipart boundary is refused
    Given I am signed in as "fileimporter@digiata.com"
    When I send an upload request whose multipart content type has no boundary
    Then the response status code is 400
    And the response message is "The upload request could not be read. Please send the file as multipart/form-data."
    And no file has been stored

  Scenario: A truncated upload request is refused
    Given I am signed in as "fileimporter@digiata.com"
    When I send an upload request whose body ends before its closing boundary
    Then the response status code is 400
    And the response message is "The upload request could not be read. Please send the file as multipart/form-data."
    And no file has been stored

  Scenario: An upload request with an unreadable part header is refused
    Given I am signed in as "fileimporter@digiata.com"
    When I send an upload request whose part header has no colon
    Then the response status code is 400
    And the response message is "The upload request could not be read. Please send the file as multipart/form-data."
    And no file has been stored
