Feature: Exporting transactions
  Only approvers export (TL-05). The export is a .csv file of exactly the transactions that match the
  list's filters, across all pages (EX-01), or of every transaction with no filters (EX-02), in the
  list's order for the same sort. It has the list's columns plus the rejection reason and who last
  changed each transaction and when (EX-03). Its file name holds the export date, in the export time
  zone (Africa/Johannesburg by default), and describes the active filters (EX-04). When nothing
  matches there is nothing to export, and the response says why (EX-05). The file opens cleanly in a
  spreadsheet: UTF-8 with a byte-order mark, CR LF line endings, RFC 4180 quoting, plain amounts and
  dates, and text that could run as a formula made harmless (EX-06).
  In queries, "{file name}" stands for the id of the seeded file with that name. In descriptions,
  [TAB], [CR] and [LF] stand for a tab, a carriage return and a line feed.

  Scenario: Every transaction is exported with the list's columns plus the review details
    Given these transactions exist:
      | reference | date                   | account    | description | amount     | currency | type   | status   | file      | rejection reason | created at           | last changed by | last changed at      |
      | TXN-001   | 2026-04-15 08:30:00    | 1234567890 | Salary      | 15750      | ZAR      | Credit | Imported | april.csv |                  | 2026-04-16T10:00:00Z |                 |                      |
      | TXN-002   | 2026-04-14 17:05:30.25 | 9876543210 | Rent        | 1234567.89 | USD      | Debit  | Approved | may.csv   |                  | 2026-04-16T10:00:00Z | Approver User   | 2026-04-17T09:15:00Z |
      | TXN-003   | 2026-04-13 00:00:00    | 5550001111 | Refund      | 0.5        | EUR      | Credit | Rejected | april.csv | Duplicate        | 2026-04-16T10:00:00Z | Approver User   | 2026-04-14T22:30:45Z |
    And I am signed in as "approver@digiata.com"
    When I export the transactions
    Then the response status code is 200
    And the exported rows are:
      | Reference | Transaction Date       | Account Number | Description | Amount     | Currency | Type   | Status   | File      | Rejection Reason | Last Changed By | Last Changed On     |
      | TXN-001   | 2026-04-15 08:30:00    | 1234567890     | Salary      | 15750.00   | ZAR      | Credit | Imported | april.csv |                  | System          | 2026-04-16 12:00:00 |
      | TXN-002   | 2026-04-14 17:05:30.25 | 9876543210     | Rent        | 1234567.89 | USD      | Debit  | Approved | may.csv   |                  | Approver User   | 2026-04-17 11:15:00 |
      | TXN-003   | 2026-04-13 00:00:00    | 5550001111     | Refund      | 0.50       | EUR      | Credit | Rejected | april.csv | Duplicate        | Approver User   | 2026-04-15 00:30:45 |

  Scenario: The export opens cleanly in a spreadsheet
    Given the current time is "2026-04-15T08:00:00Z"
    And these transactions exist:
      | reference | description |
      | TXN-001   | Café crème  |
    And I am signed in as "approver@digiata.com"
    When I export the transactions
    Then the response status code is 200
    And the response content type is "text/csv" with the charset "utf-8"
    And the export starts with a UTF-8 byte-order mark
    And every line of the export ends with a carriage return and a line feed
    And the export text is:
      """
      Reference,Transaction Date,Account Number,Description,Amount,Currency,Type,Status,File,Rejection Reason,Last Changed By,Last Changed On
      TXN-001,2026-04-15 08:00:00,1234567890,Café crème,10.00,ZAR,Credit,Imported,transactions.csv,,System,2026-04-15 10:00:00
      """

  Scenario Outline: Fields with commas, quotes or line breaks are quoted
    Given the transaction "TXN-001" exists with the description '<description>'
    And I am signed in as "approver@digiata.com"
    When I export the transactions
    Then the response status code is 200
    And the exported Description of "TXN-001" is written as '<written>'
    And the exported Description of "TXN-001" reads back as '<description>'
    And every line of the export ends with a carriage return and a line feed

    Examples:
      | case                        | description              | written                        |
      | plain text is not quoted    | Salary April             | Salary April                   |
      | a comma                     | Salary, April            | "Salary, April"                |
      | double quotes are doubled   | The "big" one            | "The ""big"" one"              |
      | a line feed                 | Line one[LF]Line two     | "Line one[LF]Line two"         |
      | a carriage return line feed | Line one[CR][LF]Line two | "Line one[CR][LF]Line two"     |
      | everything at once          | Say "hi",[LF]then leave  | "Say ""hi"",[LF]then leave"    |

  Scenario Outline: Text that a spreadsheet could run as a formula is made harmless
    Given these transactions exist:
      | reference | account   | description   | amount |
      | TXN-001   | <account> | <description> | 25.00  |
    And I am signed in as "approver@digiata.com"
    When I export the transactions
    Then the response status code is 200
    And the exported Description of "TXN-001" reads back as "<exported description>"
    And the exported Account Number of "TXN-001" reads back as "<exported account>"
    And the exported Amount of "TXN-001" reads back as "25.00"

    Examples:
      | case                         | description         | exported description  | account  | exported account |
      | equals sign                  | =1+2                | '=1+2                 | 1234     | 1234             |
      | plus sign                    | +27 82 555 0000     | '+27 82 555 0000      | 1234     | 1234             |
      | minus sign                   | -10 fee             | '-10 fee              | -1234    | '-1234           |
      | at sign                      | @SUM(A1:A2)         | '@SUM(A1:A2)          | @1234    | '@1234           |
      | a formula with a comma       | =SUM(1,2)           | '=SUM(1,2)            | 1234     | 1234             |
      | the sign only inside         | 1+1=2               | 1+1=2                 | 12-34    | 12-34            |

  Scenario Outline: A leading tab or carriage return is made harmless
    Given the transaction "TXN-001" exists with the description "<description>"
    And I am signed in as "approver@digiata.com"
    When I export the transactions
    Then the response status code is 200
    And the exported Description of "TXN-001" reads back as "<exported>"

    Examples:
      | case                   | description     | exported         |
      | leading tab            | [TAB]=1+2       | '[TAB]=1+2       |
      | leading carriage return | [CR]=1+2       | '[CR]=1+2        |
      | tab inside             | a[TAB]b         | a[TAB]b          |

  Scenario Outline: The export holds the same transactions in the same order as the list, across every page
    Given 60 transactions with varied values exist
    And I am signed in as "approver@digiata.com"
    When I export the transactions with the query "<query>"
    Then the response status code is 200
    And the export holds <count> transactions
    And the exported references are those of every page of the list with the query "<query>"

    Examples:
      | case                               | query                                                                  | count |
      | no filters, most recent first      |                                                                        | 60    |
      | sorted by amount, smallest first   | sortBy=Amount&sortDirection=Asc                                        | 60    |
      | sorted by reference, Z to A        | sortBy=Reference&sortDirection=Desc                                    | 60    |
      | sorted by status                   | sortBy=Status                                                          | 60    |
      | sorted by file name, Z to A        | sortBy=FileName&sortDirection=Desc                                     | 60    |
      | status                             | status=Imported                                                        | 20    |
      | file                               | fileId={batch-2.csv}                                                   | 20    |
      | dates                              | dateFrom=2026-04-10&dateTo=2026-04-20                                  | 22    |
      | amounts                            | minAmount=200&maxAmount=600                                            | 25    |
      | search                             | search=TXN-01                                                          | 10    |
      | combined filters and a sort        | status=Approved&dateFrom=2026-04-05&minAmount=100&sortBy=Amount&sortDirection=Desc | 16 |

  Scenario: Paging values are ignored, so every matching transaction is exported
    Given 60 transactions with varied values exist
    And I am signed in as "approver@digiata.com"
    When I export the transactions with the query "page=2&pageSize=5"
    Then the response status code is 200
    And the export holds 60 transactions

  Scenario Outline: The file name holds the export date and describes the active filters
    Given these files exist:
      | name                 |
      | April Batch #1.csv   |
      | Transações Abril.CSV |
      | ###.csv              |
    And these transactions exist:
      | reference                                             | file                 | status   | date                | amount | account    |
      | TXN-001                                               | April Batch #1.csv   | Imported | 2026-04-15 08:30:00 | 150.00 | 1234567890 |
      | INV:2026/04*Q                                         | Transações Abril.CSV | Rejected | 2026-04-15 08:30:00 | 150.00 | 1234567890 |
      | ABCDEFGHIJKLMNOPQRSTUVWXYZ-ABCDEFGHIJKLMNOPQRSTUVWXYZ | ###.csv              | Approved | 2026-04-15 08:30:00 | 150.00 | 1234567890 |
    And the current time is "2026-04-15T10:00:00Z"
    And I am signed in as "approver@digiata.com"
    When I export the transactions with the query "<query>"
    Then the response status code is 200
    And the export is an attachment named "<file name>"

    Examples:
      | case                                    | query                                                                                    | file name                                                                                           |
      | no filters                              |                                                                                          | transactions_2026-04-15.csv                                                                         |
      | a sort alone is not a filter            | sortBy=Amount&sortDirection=Desc                                                         | transactions_2026-04-15.csv                                                                         |
      | status                                  | status=Imported                                                                          | transactions_Imported_2026-04-15.csv                                                                |
      | status in any case                      | status=rejected                                                                          | transactions_Rejected_2026-04-15.csv                                                                |
      | file, made safe                         | fileId={April Batch #1.csv}                                                              | transactions_file-April-Batch-1_2026-04-15.csv                                                      |
      | file with accents and upper-case .CSV   | fileId={Transações Abril.CSV}                                                            | transactions_file-Transações-Abril_2026-04-15.csv                                                   |
      | file with nothing safe left             | fileId={###.csv}                                                                         | transactions_file_2026-04-15.csv                                                                    |
      | whole-day date range                    | dateFrom=2026-04-01&dateTo=2026-04-30                                                    | transactions_from-2026-04-01-to-2026-04-30_2026-04-15.csv                                           |
      | start date only                         | dateFrom=2026-04-01                                                                      | transactions_from-2026-04-01_2026-04-15.csv                                                         |
      | end date only                           | dateTo=2026-04-30                                                                        | transactions_to-2026-04-30_2026-04-15.csv                                                           |
      | dates with times                        | dateFrom=2026-04-15T08:00&dateTo=2026-04-15T09:30:15                                     | transactions_from-2026-04-15T0800-to-2026-04-15T093015_2026-04-15.csv                               |
      | amount range                            | minAmount=100&maxAmount=200.50                                                           | transactions_amount-100-to-200.5_2026-04-15.csv                                                     |
      | minimum amount only                     | minAmount=100.00                                                                         | transactions_amount-from-100_2026-04-15.csv                                                         |
      | maximum amount only                     | maxAmount=150.5                                                                          | transactions_amount-to-150.5_2026-04-15.csv                                                         |
      | search                                  | search=1234                                                                              | transactions_search-1234_2026-04-15.csv                                                             |
      | search made safe                        | search=inv%3A2026%2F04*                                                                  | transactions_search-inv-2026-04_2026-04-15.csv                                                      |
      | search with nothing safe left           | search=%2F                                                                               | transactions_search_2026-04-15.csv                                                                  |
      | long search is shortened                | search=ABCDEFGHIJKLMNOPQRSTUVWXYZ-ABCDEFGHIJKLMNOPQRSTUVWXYZ                             | transactions_search-ABCDEFGHIJKLMNOPQRSTUVWXYZ-ABCDEFGHIJKLM_2026-04-15.csv                         |
      | every filter, always in the same order  | search=TXN&minAmount=100&dateTo=2026-04-30&fileId={April Batch #1.csv}&status=Imported    | transactions_Imported_file-April-Batch-1_to-2026-04-30_amount-from-100_search-TXN_2026-04-15.csv    |

  Scenario Outline: The export date is today's date in Johannesburg
    Given these transactions exist:
      | reference |
      | TXN-001   |
    And the current time is "<now>"
    And I am signed in as "approver@digiata.com"
    When I export the transactions with the query "status=Imported"
    Then the response status code is 200
    And the export is an attachment named "<file name>"

    Examples:
      | case                                        | now                  | file name                            |
      | the last second of the day in Johannesburg  | 2026-04-14T21:59:59Z | transactions_Imported_2026-04-14.csv |
      | midnight in Johannesburg                    | 2026-04-14T22:00:00Z | transactions_Imported_2026-04-15.csv |
      | still the previous day in UTC               | 2026-04-14T23:30:00Z | transactions_Imported_2026-04-15.csv |

  Scenario: The export time zone can be configured
    Given these transactions exist:
      | reference | created at           |
      | TXN-001   | 2026-04-14T23:30:00Z |
    And the export time zone is "UTC"
    And the current time is "2026-04-14T23:30:00Z"
    And I am signed in as "approver@digiata.com"
    When I export the transactions
    Then the response status code is 200
    And the export is an attachment named "transactions_2026-04-14.csv"
    And the exported Last Changed On of "TXN-001" reads back as "2026-04-14 23:30:00"

  Scenario: A non-default export time zone is used for the export date and Last Changed On
    Given these transactions exist:
      | reference | created at           |
      | TXN-001   | 2026-04-14T23:30:00Z |
    And the export time zone is "Europe/London"
    And the current time is "2026-04-14T22:30:00Z"
    And I am signed in as "approver@digiata.com"
    When I export the transactions
    Then the response status code is 200
    And the export is an attachment named "transactions_2026-04-14.csv"
    And the exported Last Changed On of "TXN-001" reads back as "2026-04-15 00:30:00"

  Scenario: Transactions of a cancelled file are never exported
    Given these files exist:
      | name          | cancelled | imported |
      | cancelled.csv | yes       | 2        |
    And these transactions exist:
      | reference | file       |
      | TXN-001   | active.csv |
    And I am signed in as "approver@digiata.com"
    When I export the transactions
    Then the response status code is 200
    And the exported references are "TXN-001"
    When I export the transactions with the query "fileId={cancelled.csv}"
    Then the response status code is 409
    And the response message is "No transactions match the current filters, so there is nothing to export."

  Scenario: Nothing is exported when no transactions match the filters
    Given these transactions exist:
      | reference | status   |
      | TXN-001   | Imported |
    And I am signed in as "approver@digiata.com"
    When I export the transactions with the query "status=Rejected"
    Then the response status code is 409
    And the response message is "No transactions match the current filters, so there is nothing to export."

  Scenario: Nothing is exported when there are no transactions yet
    Given I am signed in as "approver@digiata.com"
    When I export the transactions
    Then the response status code is 409
    And the response message is "There are no transactions yet, so there is nothing to export."

  Scenario Outline: An invalid query is refused just as the list refuses it
    Given these transactions exist:
      | reference |
      | TXN-001   |
    And I am signed in as "approver@digiata.com"
    When I export the transactions with the query "<query>"
    Then the response status code is 400
    And the validation errors include the field "<field>"

    Examples:
      | case                         | query                                                  | field         |
      | unknown sort column          | sortBy=CreatedBy                                       | sortBy        |
      | sort column with SQL         | sortBy=amount%3B%20DROP%20TABLE%20transactions         | sortBy        |
      | unknown sort direction       | sortDirection=Sideways                                 | sortDirection |
      | unknown status               | status=Pending                                         | status        |
      | file id not a UUID           | fileId=april.csv                                       | fileId        |
      | unreadable start date        | dateFrom=yesterday                                     | dateFrom      |
      | impossible end date          | dateTo=2026-02-30                                      | dateTo        |
      | date with a UTC marker       | dateFrom=2026-04-15T08:00:00Z                          | dateFrom      |
      | start date after end date    | dateFrom=2026-04-16&dateTo=2026-04-15                  | dateTo        |
      | amount not a number          | minAmount=ten                                          | minAmount     |
      | negative minimum amount      | minAmount=-1                                           | minAmount     |
      | negative maximum amount      | maxAmount=-0.01                                        | maxAmount     |
      | minimum above maximum        | minAmount=100.01&maxAmount=100                         | maxAmount     |

  Scenario: An importer cannot export
    Given these transactions exist:
      | reference |
      | TXN-001   |
    And I am signed in as "fileimporter@digiata.com"
    When I export the transactions
    Then the response status code is 403
    And the response message is "You do not have access to this. Please ask your administrator for access."

  Scenario: Exporting requires a signed-in session
    When I export the transactions
    Then the response status code is 401
    And the response reason is "NotSignedIn"
