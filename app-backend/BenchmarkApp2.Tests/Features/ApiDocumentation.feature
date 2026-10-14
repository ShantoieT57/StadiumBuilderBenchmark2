Feature: API documentation
  In the Development environment the TransactionApi serves a Swagger UI page and its
  OpenAPI spec without requiring a signed-in session. Outside Development neither is served.

  Scenario: The Swagger UI page is served anonymously in Development
    Given the TransactionApi is running in the "Development" environment
    When I request the documentation path "swagger/index.html"
    Then the response status code is 200

  Scenario: The TransactionApi OpenAPI spec is served anonymously in Development
    Given the TransactionApi is running in the "Development" environment
    When I request the documentation path "swagger/TransactionApi.yaml"
    Then the response status code is 200
    And the response body contains "title: TransactionApi"

  Scenario Outline: The documentation is not served outside Development
    Given the TransactionApi is running in the "Production" environment
    When I request the documentation path "<path>"
    Then the documentation is not served

    Examples:
      | path                        |
      | swagger/index.html          |
      | swagger/TransactionApi.yaml |
