Feature: Run the file processor in the background
  The file processor is a service that can be started and stopped on its own. While it runs it
  processes every uploaded file without being asked (UP-07): an upload wakes it straight away, and it
  also checks for waiting files on a configurable interval. On start it recovers files that an
  interrupted processor left in Processing. Files are claimed so that two processors never process
  the same file.

  Background:
    Given I am signed in as "fileimporter@digiata.com"

  Scenario: The file processor can be started and stopped
    When the file processor service is started
    Then the file processor service is running
    When the file processor service is stopped
    Then the file processor service is not running

  Scenario: An upload wakes the running file processor
    Given the file processor checks for waiting files every 300 seconds
    And the file processor service is started
    When I upload the sample file "transactions_2026-04-15.csv"
    Then the last uploaded file soon has the status "Completed"
    And 20 transactions have been loaded in total

  Scenario: Files uploaded before the file processor starts are processed when it starts
    Given I have uploaded the sample file "transactions_2026-04-15.csv"
    When the file processor service is started
    Then the last uploaded file soon has the status "Completed"

  Scenario: A file left in Processing by an interrupted processor is processed again on start
    Given I have uploaded the sample file "transactions_2026-04-15.csv"
    And uploaded file 1 has been left with the status "Processing"
    When the file processor service is started
    Then the last uploaded file soon has the status "Completed"
    And 20 transactions have been loaded in total

  Scenario: Two processors running at the same time never process the same file
    Given I have uploaded 6 different files of 20 rows each
    When two file processors process the waiting files at the same time
    Then every uploaded file has the status "Completed"
    And every uploaded file has exactly one "Receive" stage in its processing history
    And 120 transactions have been loaded in total
