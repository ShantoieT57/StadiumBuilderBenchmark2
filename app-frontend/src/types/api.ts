/**
 * API Type Definitions Template
 *
 * Generic type definitions for API communication
 * Customize these based on your API's response format
 */

/**
 * DefaultResponse - Standard API response structure
 * Customize this based on your API's response format
 * Common in REST APIs for mutation endpoints (POST, PUT, DELETE)
 */
export interface DefaultResponse {
  Id: number;
  MessageType: string;
  Messages: string[];
}

/**
 * APIError - Standardized error object for API failures
 * Used throughout the application for consistent error handling
 */
export interface APIError {
  message: string;
  /**
   * HTTP status of the refused response. `0` means the request never got an
   * answer from the back-end: fetch threw, or the same-origin proxy answered
   * 502 / 503 / 504 (see `isNetworkError` in `@/lib/api/errors`).
   */
  statusCode?: number;
  details?: string[];
  endpoint?: string;
  /** True when the back-end could not be reached (statusCode 0). */
  isNetworkError?: boolean;
  /** 401 bodies: why the request was not authenticated (`UnauthenticatedReason`). */
  reason?: string;
  /** 400 ValidationProblem bodies: camelCase JSON-path keys (`$` = whole body). */
  errors?: Record<string, string[]>;
  /** The parsed JSON error body as received (e.g. the 409 `{ message, transaction }`). */
  body?: unknown;
  /**
   * True when the central 401 handler has already sent the page to sign-in
   * (a full page load is under way). Callers show nothing for it; see
   * `isRedirectingToSignIn` in `@/lib/api/errors`.
   */
  redirecting?: boolean;
}

export type QueryParamScalar = string | number | boolean;
export type QueryParams = Record<
  string,
  QueryParamScalar | ReadonlyArray<QueryParamScalar> | undefined
>;

/**
 * APIRequestConfig - Configuration options for API requests
 * Extends standard fetch RequestInit with additional options
 */
export interface APIRequestConfig extends RequestInit {
  params?: QueryParams;
  /**
   * When true, the client injects an auth header from getAuthHeader() (env-var
   * driven, populated by api-connectivity-agent during INTAKE Step 4b). Caller-
   * supplied headers always win — set headers explicitly to override.
   */
  requiresAuth?: boolean;
  lastChangedUser?: string; // For audit trails - remove if not needed
  isBinaryResponse?: boolean; // Flag to indicate response should be treated as binary data
  /**
   * When true, a successful call resolves `{ data, headers }` (`WithResponseHeaders<T>`)
   * instead of the body alone, e.g. to read a download's `Content-Disposition`.
   */
  withResponseHeaders?: boolean;
}

/** What `apiClient` resolves with when called with `withResponseHeaders: true`. */
export interface WithResponseHeaders<T> {
  data: T;
  headers: Headers;
}

/**
 * APIResponse - Generic wrapper for successful API responses
 * Provides type-safe response handling
 */
export interface APIResponse<T> {
  data: T;
  status: number;
  statusText: string;
}

/**
 * API Message Type enum values
 * Customize based on your API's message types
 */
export const APIMessageType = {
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
  WARNING: 'WARNING',
  INFO: 'INFO',
} as const;

export type APIMessageTypeValue =
  (typeof APIMessageType)[keyof typeof APIMessageType];

/**
 * HTTP Status Codes - Common status codes used in the application
 */
export const HTTPStatus = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export type HTTPStatusCode = (typeof HTTPStatus)[keyof typeof HTTPStatus];
