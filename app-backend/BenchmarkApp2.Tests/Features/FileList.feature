Feature: File list
  The dashboard lists files (DB-02) one page at a time (DB-04), most recently processed first, and
  can be sorted by any column, one at a time (DB-03). It can be filtered by status, file name and a
  range of process dates (DB-05), and shows active files, cancelled files or both (DB-06). Both
  roles see the list. A failed file says why it failed, so an importer can be offered the
  correction screen for invalid rows (DB-08).

  Scenario Outline: Each file shows its details
    Given these files exist:
      | name        | status     | failure kind | failure reason                   | last processed       | rows | imported | approved | rejected |
      | april.csv   | Completed  |              |                                  | 2026-04-15T08:30:00Z | 6    | 3        | 2        | 1        |
      | broken.csv  | Failed     | InvalidRows  | 2 rows are invalid               | 2026-04-14T08:30:00Z | 3    | 0        | 0        | 0        |
      | copy.csv    | Failed     | Duplicate    | This file was already uploaded.  | 2026-04-13T08:30:00Z | 6    | 0        | 0        | 0        |
      | waiting.csv | Uploaded   |              |                                  |                      |      | 0        | 0        | 0        |
    And I am signed in as "<email>"
    When I list the files
    Then the response status code is 200
    And the listed files are:
      | name        | status    | failure kind | failure reason                  | last processed       | rows | imported | cancelled |
      | waiting.csv | Uploaded  |              |                                 |                      |      | 0        | no        |
      | april.csv   | Completed |              |                                 | 2026-04-15T08:30:00Z | 6    | 3        | no        |
      | broken.csv  | Failed    | InvalidRows  | 2 rows are invalid              | 2026-04-14T08:30:00Z | 3    | 0        | no        |
      | copy.csv    | Failed    | Duplicate    | This file was already uploaded. | 2026-04-13T08:30:00Z | 6    | 0        | no        |
    And the page is 1 of 1 with page size 20 and 4 files in total

    Examples:
      | email                    |
      | fileimporter@digiata.com |
      | approver@digiata.com     |

  Scenario: There are no files yet
    Given I am signed in as "approver@digiata.com"
    When I list the files
    Then the response status code is 200
    And no files are listed
    And the page is 1 of 0 with page size 20 and 0 files in total

  Scenario Outline: The list can be sorted by any column
    Given these files exist:
      | name        | status     | last processed       | rows | imported |
      | alpha.csv   | Completed  | 2026-04-11T09:00:00Z | 30   | 3        |
      | Bravo.csv   | Failed     | 2026-04-13T09:00:00Z | 10   | 0        |
      | charlie.csv | Completed  | 2026-04-12T09:00:00Z | 20   | 5        |
      | delta.csv   | Uploaded   |                      |      | 0        |
    And I am signed in as "fileimporter@digiata.com"
    When I list the files with the query "<query>"
    Then the response status code is 200
    And the listed file names are "<names>"

    Examples:
      | case                                          | query                                         | names                                          |
      | most recently processed first by default      |                                               | delta.csv, Bravo.csv, charlie.csv, alpha.csv   |
      | last processed, oldest first                  | sortBy=LastProcessedAt&sortDirection=Asc      | alpha.csv, charlie.csv, Bravo.csv, delta.csv   |
      | last processed defaults to most recent first  | sortBy=LastProcessedAt                        | delta.csv, Bravo.csv, charlie.csv, alpha.csv   |
      | name ignoring case, A to Z                    | sortBy=FileName&sortDirection=Asc             | alpha.csv, Bravo.csv, charlie.csv, delta.csv   |
      | name ignoring case, Z to A                    | sortBy=FileName&sortDirection=Desc            | delta.csv, charlie.csv, Bravo.csv, alpha.csv   |
      | another column defaults to ascending          | sortBy=FileName                               | alpha.csv, Bravo.csv, charlie.csv, delta.csv   |
      | rows, fewest first                            | sortBy=RowCount&sortDirection=Asc             | Bravo.csv, charlie.csv, alpha.csv, delta.csv   |
      | rows, most first                              | sortBy=RowCount&sortDirection=Desc            | delta.csv, alpha.csv, charlie.csv, Bravo.csv   |
      | status in order of progress, ties by received | sortBy=Status&sortDirection=Asc               | delta.csv, alpha.csv, charlie.csv, Bravo.csv   |
      | status in reverse order of progress           | sortBy=Status&sortDirection=Desc              | Bravo.csv, charlie.csv, alpha.csv, delta.csv   |
      | still imported, fewest first                  | sortBy=ImportedCount&sortDirection=Asc        | Bravo.csv, delta.csv, alpha.csv, charlie.csv   |
      | still imported, most first                    | sortBy=ImportedCount&sortDirection=Desc       | charlie.csv, alpha.csv, delta.csv, Bravo.csv   |
      | sort values ignore upper and lower case       | sortBy=filename&sortDirection=desc            | delta.csv, charlie.csv, Bravo.csv, alpha.csv   |

  Scenario Outline: The page size can be 5, 10, 20 or 50
    Given 55 files exist that were all last processed at "2026-04-15T08:00:00Z"
    And I am signed in as "fileimporter@digiata.com"
    When I list the files with the query "<query>"
    Then the response status code is 200
    And the page lists <listed> files
    And the page is <page> of <pages> with page size <size> and 55 files in total

    Examples:
      | query               | listed | page | pages | size |
      |                     | 20     | 1    | 3     | 20   |
      | page=3              | 15     | 3    | 3     | 20   |
      | pageSize=5          | 5      | 1    | 11    | 5    |
      | pageSize=10&page=6  | 5      | 6    | 6     | 10   |
      | pageSize=50         | 50     | 1    | 2     | 50   |
      | pageSize=50&page=2  | 5      | 2    | 2     | 50   |
      | page=4              | 0      | 4    | 3     | 20   |

  Scenario: Paging lists every file exactly once even when sorted values are the same
    Given 25 files exist that were all last processed at "2026-04-15T08:00:00Z"
    And I am signed in as "fileimporter@digiata.com"
    When I list pages 1 to 3 of the files with the query "pageSize=10&sortBy=LastProcessedAt"
    Then every one of the 25 files is listed exactly once
    And the files are listed in the reverse of the order they were received

  Scenario Outline: An invalid query is refused
    Given I am signed in as "fileimporter@digiata.com"
    When I list the files with the query "<query>"
    Then the response status code is 400
    And the validation errors include the field "<field>"

    Examples:
      | case                         | query                                                                 | field         |
      | page size not offered        | pageSize=7                                                            | pageSize      |
      | page size zero               | pageSize=0                                                            | pageSize      |
      | page size too large          | pageSize=100                                                          | pageSize      |
      | page below 1                 | page=0                                                                | page          |
      | unknown sort column          | sortBy=UploadedBy                                                     | sortBy        |
      | sort column with SQL         | sortBy=file_name%3B%20DROP%20TABLE%20files                            | sortBy        |
      | unknown sort direction       | sortDirection=Sideways                                                | sortDirection |
      | unknown status               | status=Archived                                                       | status        |
      | unknown visibility           | visibility=Hidden                                                     | visibility    |
      | unreadable date              | processedFrom=yesterday                                               | processedFrom |
      | from after to                | processedFrom=2026-04-16T00:00:00Z&processedTo=2026-04-15T00:00:00Z   | processedTo   |

  Scenario Outline: The list can be filtered by status
    Given these files exist:
      | name         | status     | last processed       |
      | waiting.csv  | Uploaded   |                      |
      | checking.csv | Processing |                      |
      | april.csv    | Completed  | 2026-04-15T08:00:00Z |
      | may.csv      | Completed  | 2026-05-15T08:00:00Z |
      | broken.csv   | Failed     | 2026-04-14T08:00:00Z |
    And I am signed in as "approver@digiata.com"
    When I list the files with the query "status=<status>"
    Then the response status code is 200
    And the listed file names are "<names>"
    And the page is 1 of 1 with page size 20 and <total> files in total

    Examples:
      | status     | names                | total |
      | Uploaded   | waiting.csv          | 1     |
      | Processing | checking.csv         | 1     |
      | Completed  | may.csv, april.csv   | 2     |
      | Failed     | broken.csv           | 1     |

  Scenario Outline: The list can be filtered by part of the file name, ignoring case
    Given these files exist:
      | name                   | last processed       |
      | Transactions_April.csv | 2026-04-15T08:00:00Z |
      | transactions_may.csv   | 2026-04-14T08:00:00Z |
      | april_100%.csv         | 2026-04-13T08:00:00Z |
      | summary.csv            | 2026-04-12T08:00:00Z |
    And I am signed in as "approver@digiata.com"
    When I list the files with the query "fileName=<file name>"
    Then the response status code is 200
    And the listed file names are "<names>"

    Examples:
      | case                         | file name     | names                                                        |
      | different case               | APRIL         | Transactions_April.csv, april_100%.csv                       |
      | percent matched literally    | %25           | april_100%.csv                                               |
      | underscore matched literally | s_            | Transactions_April.csv, transactions_may.csv                 |
      | extension                    | .CSV          | Transactions_April.csv, transactions_may.csv, april_100%.csv, summary.csv |
      | no match                     | june          |                                                              |

  Scenario: A file name filter is never run as SQL
    Given these files exist:
      | name      | last processed       |
      | april.csv | 2026-04-15T08:00:00Z |
    And I am signed in as "approver@digiata.com"
    When I list the files with the query "fileName=%27%3B%20DROP%20TABLE%20files%3B%20--"
    Then the response status code is 200
    And no files are listed
    When I list the files
    Then the listed file names are "april.csv"

  Scenario Outline: The list can be filtered by a range of process dates, inclusive of both ends
    Given these files exist:
      | name        | last processed           |
      | early.csv   | 2026-04-14T23:59:59Z     |
      | start.csv   | 2026-04-15T00:00:00Z     |
      | middle.csv  | 2026-04-16T12:00:00Z     |
      | end.csv     | 2026-04-17T23:59:59.999Z |
      | late.csv    | 2026-04-18T00:00:00Z     |
      | waiting.csv |                          |
    And I am signed in as "fileimporter@digiata.com"
    When I list the files with the query "<query>"
    Then the response status code is 200
    And the listed file names are "<names>"

    Examples:
      | case                      | query                                                                           | names                                       |
      | from and to               | processedFrom=2026-04-15T00:00:00Z&processedTo=2026-04-17T23:59:59.999Z         | end.csv, middle.csv, start.csv              |
      | from only                 | processedFrom=2026-04-15T00:00:00Z                                              | late.csv, end.csv, middle.csv, start.csv    |
      | to only                   | processedTo=2026-04-15T00:00:00Z                                                | start.csv, early.csv                        |
      | the same moment           | processedFrom=2026-04-16T12:00:00Z&processedTo=2026-04-16T12:00:00Z             | middle.csv                                  |
      | a day in another zone     | processedFrom=2026-04-15T00:00:00%2B02:00&processedTo=2026-04-15T23:59:59%2B02:00 | start.csv, early.csv                      |

  Scenario: Filters combine
    Given these files exist:
      | name             | status    | last processed       |
      | april_bank.csv   | Completed | 2026-04-15T08:00:00Z |
      | april_bank_2.csv | Failed    | 2026-04-15T09:00:00Z |
      | april_card.csv   | Completed | 2026-04-16T08:00:00Z |
      | may_bank.csv     | Completed | 2026-05-15T08:00:00Z |
    And I am signed in as "fileimporter@digiata.com"
    When I list the files with the query "status=Completed&fileName=bank&processedFrom=2026-04-01T00:00:00Z&processedTo=2026-04-30T23:59:59Z"
    Then the response status code is 200
    And the listed file names are "april_bank.csv"
    And the page is 1 of 1 with page size 20 and 1 files in total

  Scenario: Cancelled files are hidden by default
    Given these files exist:
      | name          | last processed       | cancelled |
      | active.csv    | 2026-04-15T08:00:00Z | no        |
      | cancelled.csv | 2026-04-14T08:00:00Z | yes       |
    And I am signed in as "fileimporter@digiata.com"
    When I list the files
    Then the listed files are:
      | name       | cancelled |
      | active.csv | no        |

  Scenario Outline: Active files, cancelled files or both can be listed
    Given these files exist:
      | name          | last processed       | cancelled |
      | active.csv    | 2026-04-15T08:00:00Z | no        |
      | cancelled.csv | 2026-04-14T08:00:00Z | yes       |
    And I am signed in as "approver@digiata.com"
    When I list the files with the query "visibility=<visibility>"
    Then the response status code is 200
    And the listed file names are "<names>"
    And the listed files are cancelled: "<cancelled>"

    Examples:
      | visibility | names                     | cancelled |
      | Active     | active.csv                | no        |
      | Cancelled  | cancelled.csv             | yes       |
      | Both       | active.csv, cancelled.csv | no, yes   |

  Scenario: Listing files requires a signed-in session
    When I list the files
    Then the response status code is 401
    And the response reason is "NotSignedIn"
