Feature: Transactions list
  Both roles see the transactions list (TL-01), most recent transaction date first, sortable by any
  column one at a time with an order that stays put while paging (TL-02), 20 per page by default or
  5, 10 or 50 (TL-03). It can be filtered by status, file, a range of transaction dates, a range of
  amounts and text matching the reference or account number (SF-01); filters combine (SF-02). An
  empty list says whether there are no transactions at all (TL-08) or none match (SF-04).
  In queries, "{file name}" stands for the id of the seeded file with that name.

  Scenario Outline: Each transaction shows its details and its file
    Given these transactions exist:
      | reference | date                   | account    | description | amount  | currency | type   | status   | file      |
      | TXN-001   | 2026-04-15 08:30:00    | 1234567890 | Salary      | 1500    | ZAR      | Credit | Imported | april.csv |
      | TXN-002   | 2026-04-14 17:05:30.25 | 9876543210 | Rent        | 7250.5  | USD      | Debit  | Approved | may.csv   |
      | TXN-003   | 2026-04-13 00:00:00    | 5550001111 | Refund      | 0.99    | EUR      | Credit | Rejected | april.csv |
    And I am signed in as "<email>"
    When I list the transactions
    Then the response status code is 200
    And the listed transactions are:
      | reference | date                   | account    | description | amount  | currency | type   | status   | file      |
      | TXN-001   | 2026-04-15T08:30:00    | 1234567890 | Salary      | 1500.00 | ZAR      | Credit | Imported | april.csv |
      | TXN-002   | 2026-04-14T17:05:30.25 | 9876543210 | Rent        | 7250.50 | USD      | Debit  | Approved | may.csv   |
      | TXN-003   | 2026-04-13T00:00:00    | 5550001111 | Refund      | 0.99    | EUR      | Credit | Rejected | april.csv |
    And the page is 1 of 1 with page size 20 and 3 transactions in total
    And the list says that transactions exist

    Examples:
      | email                    |
      | fileimporter@digiata.com |
      | approver@digiata.com     |

  Scenario: There are no transactions yet
    Given I am signed in as "approver@digiata.com"
    When I list the transactions
    Then the response status code is 200
    And no transactions are listed
    And the page is 1 of 0 with page size 20 and 0 transactions in total
    And the list says that no transactions exist

  Scenario: No transactions match the filters
    Given these transactions exist:
      | reference | status   |
      | TXN-001   | Imported |
    And I am signed in as "approver@digiata.com"
    When I list the transactions with the query "status=Rejected"
    Then the response status code is 200
    And no transactions are listed
    And the list says that transactions exist

  Scenario: Transactions of a cancelled file are never listed
    Given these files exist:
      | name          | cancelled | imported |
      | cancelled.csv | yes       | 2        |
    And I am signed in as "approver@digiata.com"
    When I list the transactions
    Then no transactions are listed
    And the list says that no transactions exist
    When I list the transactions with the query "fileId={cancelled.csv}"
    Then the response status code is 200
    And no transactions are listed

  Scenario Outline: The list can be sorted by any column
    Given these transactions exist:
      | reference | date                | account | description | amount  | currency | type   | status   | file        |
      | b-200     | 2026-04-12 09:00:00 | 3000    | rent        | 100.00  | ZAR      | Debit  | Approved | Bravo.csv   |
      | A-100     | 2026-04-14 09:00:00 | 1000    | Coffee      | 20.50   | usd      | Credit | Rejected | alpha.csv   |
      | c-300     | 2026-04-11 09:00:00 | 2000    | Salary      | 1500.00 | EUR      | Credit | Imported | charlie.csv |
      | D-400     | 2026-04-13 09:00:00 | 4000    | bonus       | 3.00    | GBP      | Debit  | Imported | alpha.csv   |
    And I am signed in as "fileimporter@digiata.com"
    When I list the transactions with the query "<query>"
    Then the response status code is 200
    And the listed references are "<references>"

    Examples:
      | case                                         | query                                          | references                 |
      | most recent transaction date first           |                                                | A-100, D-400, b-200, c-300 |
      | transaction date, oldest first               | sortBy=TransactionDate&sortDirection=Asc       | c-300, b-200, D-400, A-100 |
      | transaction date defaults to most recent     | sortBy=TransactionDate                         | A-100, D-400, b-200, c-300 |
      | reference ignoring case, A to Z              | sortBy=Reference&sortDirection=Asc             | A-100, b-200, c-300, D-400 |
      | reference ignoring case, Z to A              | sortBy=Reference&sortDirection=Desc            | D-400, c-300, b-200, A-100 |
      | account number ascending                     | sortBy=AccountNumber&sortDirection=Asc         | A-100, c-300, b-200, D-400 |
      | account number descending                    | sortBy=AccountNumber&sortDirection=Desc        | D-400, b-200, c-300, A-100 |
      | description ignoring case, A to Z            | sortBy=Description&sortDirection=Asc           | D-400, A-100, b-200, c-300 |
      | description ignoring case, Z to A            | sortBy=Description&sortDirection=Desc          | c-300, b-200, A-100, D-400 |
      | amount by value, smallest first              | sortBy=Amount&sortDirection=Asc                | D-400, A-100, b-200, c-300 |
      | amount by value, largest first               | sortBy=Amount&sortDirection=Desc               | c-300, b-200, A-100, D-400 |
      | another column defaults to ascending         | sortBy=Amount                                  | D-400, A-100, b-200, c-300 |
      | currency ignoring case, A to Z               | sortBy=Currency&sortDirection=Asc              | c-300, D-400, A-100, b-200 |
      | currency ignoring case, Z to A               | sortBy=Currency&sortDirection=Desc             | b-200, A-100, D-400, c-300 |
      | credit before debit, ties by reference       | sortBy=TransactionType&sortDirection=Asc       | A-100, c-300, b-200, D-400 |
      | debit before credit, ties by reference       | sortBy=TransactionType&sortDirection=Desc      | D-400, b-200, c-300, A-100 |
      | status in order of review                    | sortBy=Status&sortDirection=Asc                | c-300, D-400, b-200, A-100 |
      | status in reverse order of review            | sortBy=Status&sortDirection=Desc               | A-100, b-200, D-400, c-300 |
      | file name ignoring case, A to Z              | sortBy=FileName&sortDirection=Asc              | A-100, D-400, b-200, c-300 |
      | file name ignoring case, Z to A              | sortBy=FileName&sortDirection=Desc             | c-300, b-200, D-400, A-100 |
      | sort values ignore upper and lower case      | sortBy=amount&sortDirection=desc               | c-300, b-200, A-100, D-400 |

  Scenario Outline: The page size can be 5, 10, 20 or 50
    Given 55 transactions exist that are all dated "2026-04-15 08:00:00"
    And I am signed in as "approver@digiata.com"
    When I list the transactions with the query "<query>"
    Then the response status code is 200
    And the page lists <listed> transactions
    And the page is <page> of <pages> with page size <size> and 55 transactions in total

    Examples:
      | query              | listed | page | pages | size |
      |                    | 20     | 1    | 3     | 20   |
      | page=3             | 15     | 3    | 3     | 20   |
      | pageSize=5         | 5      | 1    | 11    | 5    |
      | pageSize=10&page=6 | 5      | 6    | 6     | 10   |
      | pageSize=50        | 50     | 1    | 2     | 50   |
      | pageSize=50&page=2 | 5      | 2    | 2     | 50   |
      | page=4             | 0      | 4    | 3     | 20   |

  Scenario Outline: Paging lists every transaction exactly once even when sorted values are the same
    Given 25 transactions exist that are all dated "2026-04-15 08:00:00"
    And I am signed in as "approver@digiata.com"
    When I list pages 1 to 3 of the transactions with the query "pageSize=10&<sort>"
    Then every one of the 25 transactions is listed exactly once
    And the transactions from all pages are listed by reference, <order>

    Examples:
      | sort                                     | order      |
      | sortBy=TransactionDate                   | descending |
      | sortBy=TransactionDate&sortDirection=Asc | ascending  |
      | sortBy=Status                            | ascending  |
      | sortBy=Amount&sortDirection=Desc         | descending |

  Scenario Outline: An invalid query is refused
    Given I am signed in as "fileimporter@digiata.com"
    When I list the transactions with the query "<query>"
    Then the response status code is 400
    And the validation errors include the field "<field>"

    Examples:
      | case                         | query                                                  | field         |
      | page size not offered        | pageSize=7                                             | pageSize      |
      | page size zero               | pageSize=0                                             | pageSize      |
      | page size too large          | pageSize=100                                           | pageSize      |
      | page below 1                 | page=0                                                 | page          |
      | unknown sort column          | sortBy=CreatedBy                                       | sortBy        |
      | sort column with SQL         | sortBy=amount%3B%20DROP%20TABLE%20transactions         | sortBy        |
      | unknown sort direction       | sortDirection=Sideways                                 | sortDirection |
      | unknown status               | status=Pending                                         | status        |
      | file id not a UUID           | fileId=april.csv                                       | fileId        |
      | unreadable start date        | dateFrom=yesterday                                     | dateFrom      |
      | impossible end date          | dateTo=2026-02-30                                      | dateTo        |
      | date with a UTC marker       | dateFrom=2026-04-15T08:00:00Z                          | dateFrom      |
      | date with an offset          | dateTo=2026-04-15T08:00:00%2B02:00                     | dateTo        |
      | start date after end date    | dateFrom=2026-04-16&dateTo=2026-04-15                  | dateTo        |
      | start time after end time    | dateFrom=2026-04-15T10:00&dateTo=2026-04-15T09:59:59   | dateTo        |
      | amount not a number          | minAmount=ten                                          | minAmount     |
      | negative minimum amount      | minAmount=-1                                           | minAmount     |
      | negative maximum amount      | maxAmount=-0.01                                        | maxAmount     |
      | minimum above maximum        | minAmount=100.01&maxAmount=100                         | maxAmount     |

  Scenario Outline: The list can be filtered by status
    Given these transactions exist:
      | reference | status   | date                |
      | TXN-001   | Imported | 2026-04-15 09:00:00 |
      | TXN-002   | Approved | 2026-04-14 09:00:00 |
      | TXN-003   | Rejected | 2026-04-13 09:00:00 |
      | TXN-004   | Imported | 2026-04-12 09:00:00 |
    And I am signed in as "approver@digiata.com"
    When I list the transactions with the query "status=<status>"
    Then the response status code is 200
    And the listed references are "<references>"
    And the page is 1 of 1 with page size 20 and <total> transactions in total

    Examples:
      | status   | references       | total |
      | Imported | TXN-001, TXN-004 | 2     |
      | Approved | TXN-002          | 1     |
      | Rejected | TXN-003          | 1     |
      | imported | TXN-001, TXN-004 | 2     |

  Scenario Outline: The list can be filtered by file
    Given these transactions exist:
      | reference | file      | date                |
      | TXN-001   | april.csv | 2026-04-15 09:00:00 |
      | TXN-002   | may.csv   | 2026-04-14 09:00:00 |
      | TXN-003   | april.csv | 2026-04-13 09:00:00 |
    And I am signed in as "fileimporter@digiata.com"
    When I list the transactions with the query "<query>"
    Then the response status code is 200
    And the listed references are "<references>"

    Examples:
      | case         | query                                       | references       |
      | april        | fileId={april.csv}                          | TXN-001, TXN-003 |
      | may          | fileId={may.csv}                            | TXN-002          |
      | unknown file | fileId=00000000-0000-0000-0000-000000000001 |                  |

  Scenario Outline: The list can be filtered by a range of transaction dates, inclusive of both ends
    Given these transactions exist:
      | reference | date                       |
      | early     | 2026-04-14 23:59:59.999999 |
      | start     | 2026-04-15 00:00:00        |
      | middle    | 2026-04-16 12:00:00        |
      | end       | 2026-04-17 23:59:59.999999 |
      | late      | 2026-04-18 00:00:00        |
    And I am signed in as "approver@digiata.com"
    When I list the transactions with the query "<query>"
    Then the response status code is 200
    And the listed references are "<references>"

    Examples:
      | case                                 | query                                                      | references                     |
      | whole days from and to               | dateFrom=2026-04-15&dateTo=2026-04-17                      | end, middle, start             |
      | from a day                           | dateFrom=2026-04-15                                        | late, end, middle, start       |
      | to the end of a day                  | dateTo=2026-04-15                                          | start, early                   |
      | a single day                         | dateFrom=2026-04-16&dateTo=2026-04-16                      | middle                         |
      | from and to moments                  | dateFrom=2026-04-15T00:00:00&dateTo=2026-04-16T12:00:00    | middle, start                  |
      | the same moment, without seconds     | dateFrom=2026-04-16T12:00&dateTo=2026-04-16T12:00          | middle                         |
      | to a moment with a fraction          | dateTo=2026-04-14T23:59:59.999999                          | early                          |
      | from a moment with a fraction        | dateFrom=2026-04-17T23:59:59.999999                        | late, end                      |

  Scenario Outline: The list can be filtered by a range of amounts, inclusive of both ends
    Given these transactions exist:
      | reference | amount |
      | a-zero    | 0.00   |
      | a-low     | 99.99  |
      | a-min     | 100.00 |
      | a-mid     | 250.50 |
      | a-max     | 500.00 |
      | a-high    | 500.01 |
    And I am signed in as "approver@digiata.com"
    When I list the transactions with the query "sortBy=Amount&<query>"
    Then the response status code is 200
    And the listed references are "<references>"

    Examples:
      | case                         | query                           | references                  |
      | minimum and maximum          | minAmount=100&maxAmount=500     | a-min, a-mid, a-max         |
      | minimum only                 | minAmount=100.00                | a-min, a-mid, a-max, a-high |
      | maximum only                 | maxAmount=99.99                 | a-zero, a-low               |
      | decimals equal at both ends  | minAmount=250.5&maxAmount=250.50 | a-mid                      |
      | zero                         | maxAmount=0                     | a-zero                      |
      | equal ends that match none   | minAmount=300&maxAmount=300     |                             |

  Scenario Outline: The list can be filtered by text in the reference or account number
    Given these transactions exist:
      | reference    | account    |
      | INV_2026-001 | 1234567890 |
      | inv-2026-002 | 5550001111 |
      | PAY%50       | 9990002222 |
      | REF-123      | ACC_77     |
    And I am signed in as "approver@digiata.com"
    When I list the transactions with the query "sortBy=Reference&search=<search>"
    Then the response status code is 200
    And the listed references are "<references>"

    Examples:
      | case                                 | search      | references                  |
      | reference ignoring case              | INV         | INV_2026-001, inv-2026-002  |
      | account number                       | 555         | inv-2026-002                |
      | reference or account number          | 123         | INV_2026-001, REF-123       |
      | account number ignoring case         | acc         | REF-123                     |
      | percent matched literally            | %25         | PAY%50                      |
      | underscore matched literally         | _           | INV_2026-001, REF-123       |
      | underscore is not a wildcard         | V_2         | INV_2026-001                |
      | surrounding spaces are ignored       | %20inv-%20  | inv-2026-002                |
      | no match                             | zzz         |                             |

  Scenario: A text filter is never run as SQL
    Given these transactions exist:
      | reference |
      | TXN-001   |
    And I am signed in as "approver@digiata.com"
    When I list the transactions with the query "search=%27%3B%20DROP%20TABLE%20transactions%3B%20--"
    Then the response status code is 200
    And no transactions are listed
    When I list the transactions
    Then the listed references are "TXN-001"

  Scenario: Filters combine
    Given these transactions exist:
      | reference | status   | file      | date                | amount  | account    |
      | match     | Imported | april.csv | 2026-04-15 09:00:00 | 150.00  | 1234567890 |
      | approved  | Approved | april.csv | 2026-04-15 09:00:00 | 150.00  | 1234567890 |
      | other     | Imported | may.csv   | 2026-04-15 09:00:00 | 150.00  | 1234567890 |
      | too-early | Imported | april.csv | 2026-04-01 09:00:00 | 150.00  | 1234567890 |
      | too-big   | Imported | april.csv | 2026-04-15 09:00:00 | 1500.00 | 1234567890 |
      | no-text   | Imported | april.csv | 2026-04-15 09:00:00 | 150.00  | 9999999999 |
    And I am signed in as "approver@digiata.com"
    When I list the transactions with the query "status=Imported&fileId={april.csv}&dateFrom=2026-04-10&dateTo=2026-04-20&minAmount=100&maxAmount=200&search=12345"
    Then the response status code is 200
    And the listed references are "match"
    And the page is 1 of 1 with page size 20 and 1 transactions in total
    And the list says that transactions exist

  Scenario: Listing transactions requires a signed-in session
    When I list the transactions
    Then the response status code is 401
    And the response reason is "NotSignedIn"
