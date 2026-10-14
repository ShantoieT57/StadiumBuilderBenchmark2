Feature: Check the settings when the application starts
  The application checks its settings when it starts, before it migrates the database or starts any
  service, so a misconfigured application stops straight away with a clear, logged error instead of
  failing later while handling requests. Each error names the setting and its invalid value, and
  every invalid setting is reported at once, not just the first.

  The export time zone is a time-zone id that .NET resolves on the host: an IANA id such as
  "Europe/London", or a Windows id such as "GMT Standard Time" where .NET can convert it (ICU).

  Scenario: The default settings are valid
    When the default settings are checked
    Then no setting is reported as invalid

  Scenario: The application starts with valid settings
    Given the application's settings are valid
    When the application is started
    Then the application's TransactionApi is running
    And the application's file processor is running

  Scenario Outline: An invalid setting stops the application from starting
    Given the application's settings are valid
    And the application setting "<setting>" is "<value>"
    When the application is started
    Then the application fails to start, reporting:
      | error   |
      | <error> |
    And the application's TransactionApi is not running
    And the application's file processor is not running

    Examples:
      | case                         | setting                          | value                     | error                                                                                                                            |
      | unknown time zone            | ExportTimeZone                   | Mars/Olympus              | AppSettings.ExportTimeZone "Mars/Olympus" is not a known time zone.                                                              |
      | empty time zone              | ExportTimeZone                   |                           | AppSettings.ExportTimeZone "" is not a known time zone.                                                                          |
      | zero session timeout         | SessionInactivityTimeoutMinutes  | 0                         | AppSettings.SessionInactivityTimeoutMinutes "0" must be greater than 0.                                                          |
      | negative session timeout     | SessionInactivityTimeoutMinutes  | -5                        | AppSettings.SessionInactivityTimeoutMinutes "-5" must be greater than 0.                                                         |
      | zero upload size             | MaxUploadSizeBytes               | 0                         | AppSettings.MaxUploadSizeBytes "0" must be greater than 0.                                                                       |
      | zero poll interval           | FileProcessorPollIntervalSeconds | 0                         | AppSettings.FileProcessorPollIntervalSeconds "0" must be greater than 0.                                                         |
      | relative TransactionApi URI  | TransactionApiUri                | /api                      | AppSettings.TransactionApiUri "/api" must be an absolute http or https URI.                                                      |
      | not a URI                    | TransactionApiUri                | not a uri                 | AppSettings.TransactionApiUri "not a uri" must be an absolute http or https URI.                                                 |
      | other scheme                 | TransactionApiUri                | ftp://localhost:5100/api  | AppSettings.TransactionApiUri "ftp://localhost:5100/api" must be an absolute http or https URI.                                  |
      | port 5000                    | TransactionApiUri                | http://localhost:5000/api | AppSettings.TransactionApiUri "http://localhost:5000/api" must not use port 5000, which the application-service endpoint uses. |
      | empty connection string      | DatabaseConnectionString         |                           | AppSettings.DatabaseConnectionString must not be empty.                                                                          |
      | zero heartbeat interval      | EventStreamHeartbeatSeconds      | 0                         | AppSettings.EventStreamHeartbeatSeconds "0" must be greater than 0.                                                              |
      | too long heartbeat interval  | EventStreamHeartbeatSeconds      | 301                       | AppSettings.EventStreamHeartbeatSeconds "301" must not be greater than 300.                                                      |

  Scenario: Every invalid setting is reported together
    Given the application's settings are valid
    And the application setting "ExportTimeZone" is "Mars/Olympus"
    And the application setting "SessionInactivityTimeoutMinutes" is "0"
    And the application setting "MaxUploadSizeBytes" is "-1"
    And the application setting "FileProcessorPollIntervalSeconds" is "0"
    And the application setting "TransactionApiUri" is "https://localhost:5000"
    And the application setting "DatabaseConnectionString" is " "
    When the application is started
    Then the application fails to start, reporting:
      | error                                                                                                                         |
      | AppSettings.TransactionApiUri "https://localhost:5000" must not use port 5000, which the application-service endpoint uses. |
      | AppSettings.SessionInactivityTimeoutMinutes "0" must be greater than 0.                                                       |
      | AppSettings.MaxUploadSizeBytes "-1" must be greater than 0.                                                                   |
      | AppSettings.DatabaseConnectionString must not be empty.                                                                       |
      | AppSettings.FileProcessorPollIntervalSeconds "0" must be greater than 0.                                                      |
      | AppSettings.ExportTimeZone "Mars/Olympus" is not a known time zone.                                                           |
    And the application's TransactionApi is not running
    And the application's file processor is not running

  Scenario Outline: Any known time zone is accepted
    Given the application's settings are valid
    And the application setting "ExportTimeZone" is "<time zone>"
    When the application is started
    Then the application's TransactionApi is running

    Examples:
      | time zone     |
      | Europe/London |
      | UTC           |
