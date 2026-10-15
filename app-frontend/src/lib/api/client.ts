/**
 * Base API Client Template
 *
 * A reusable fetch wrapper providing:
 * - Error handling for common HTTP status codes
 * - Automatic JSON parsing
 * - Request/response logging for development
 * - Type-safe API responses
 *
 * USAGE:
 * - Requests go to the same-origin `/api` proxy (API_BASE_URL in constants.ts),
 *   which forwards them, with the session cookie, to the server-only BACKEND_URL.
 * - Endpoint functions live in endpoints.ts.
 * - Errors: see `APIError` (@/types/api) and the helpers in ./errors.ts.
 */

import { UNREACHABLE_STATUSES } from '@/lib/api/errors';
import { redirectToSignIn } from '@/lib/auth/signIn';
import { API_BASE_URL } from '@/lib/utils/constants';
import type {
  APIError,
  APIRequestConfig,
  DefaultResponse,
  HTTPStatusCode,
  QueryParams,
} from '@/types/api';

/**
 * Main API client function that wraps fetch with error handling and logging
 *
 * @param endpoint - API endpoint path (e.g., '/v1/resource')
 * @param config - Request configuration including method, body, headers, etc.
 * @returns Promise with parsed JSON response
 * @throws APIError on HTTP errors or network failures
 */
export async function apiClient<T = unknown>(
  endpoint: string,
  config: APIRequestConfig = {},
): Promise<T> {
  const {
    params,
    lastChangedUser,
    isBinaryResponse,
    requiresAuth,
    ...fetchConfig
  } = config;

  // Build full URL with query parameters
  const url = buildUrl(endpoint, params);

  // Build headers
  const headers = buildHeaders(
    fetchConfig.method,
    lastChangedUser,
    fetchConfig.headers,
    fetchConfig.body ?? undefined,
    requiresAuth,
  );

  // Log request in development
  logRequest(url, fetchConfig.method || 'GET', fetchConfig.body ?? undefined);

  try {
    const response = await fetch(url, {
      ...fetchConfig,
      headers,
      body: fetchConfig.body ?? undefined,
    });

    // Log response in development
    logResponse(response);

    // Handle specific error status codes
    if (!response.ok) {
      throw await apiErrorFromResponse(response, url);
    }

    // Handle successful responses
    return await handleSuccessResponse<T>(response, isBinaryResponse);
  } catch (error) {
    // Handle network errors or other unexpected errors
    if (error instanceof Error && error.name === 'TypeError') {
      throw createNetworkError(url);
    }

    // Re-throw API errors
    throw error;
  }
}

/**
 * Builds the full URL with query parameters.
 *
 * Array values serialize as repeated params (`['a','b']` → `?k=a&k=b`); for
 * `explode: false` APIs, join at the endpoint-function layer. Empty arrays and
 * `undefined` values drop the key entirely (the "clear all filters" path). An
 * explicit empty string IS sent for scalars (`?k=`) — caller chose that. Array
 * items that are empty strings are dropped, since an array of empty strings is
 * never a meaningful filter selection.
 */
function buildUrl(endpoint: string, params?: QueryParams): string {
  const baseUrl = `${API_BASE_URL}${endpoint}`;

  if (!params) {
    return baseUrl;
  }

  const queryParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== '') {
          queryParams.append(key, String(item));
        }
      });
      return;
    }
    queryParams.append(key, String(value));
  });

  const queryString = queryParams.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

/**
 * Builds request headers
 * Only sets Content-Type when there's a request body
 * Injects auth header from getAuthHeader() when requiresAuth is true and an
 * explicit override isn't already present in customHeaders
 */
function buildHeaders(
  method?: string,
  lastChangedUser?: string,
  customHeaders?: HeadersInit,
  body?: BodyInit,
  requiresAuth?: boolean,
): Record<string, string> {
  const baseHeaders: Record<string, string> = {};

  // Convert HeadersInit to plain object if needed
  if (customHeaders) {
    if (customHeaders instanceof Headers) {
      customHeaders.forEach((value, key) => {
        baseHeaders[key] = value;
      });
    } else if (Array.isArray(customHeaders)) {
      customHeaders.forEach(([key, value]) => {
        baseHeaders[key] = value;
      });
    } else {
      Object.assign(baseHeaders, customHeaders);
    }
  }

  // Only set Content-Type for requests with a body
  const hasBody = body !== undefined;
  const methodsWithBody = ['POST', 'PUT', 'PATCH'];
  const shouldSetContentType =
    hasBody || (method && methodsWithBody.includes(method.toUpperCase()));

  if (shouldSetContentType && !baseHeaders['Content-Type']) {
    baseHeaders['Content-Type'] = 'application/json';
  }

  // Add custom headers (e.g., LastChangedUser for audit trails)
  if (lastChangedUser) {
    baseHeaders['LastChangedUser'] = lastChangedUser;
  }

  // Inject auth header when the caller asked for it and the header is configured
  // via env vars captured during INTAKE Step 4b. Caller-provided headers win.
  if (requiresAuth) {
    const authHeader = getAuthHeader();
    if (authHeader && !(authHeader.name in baseHeaders)) {
      baseHeaders[authHeader.name] = authHeader.value;
    }
  }

  return baseHeaders;
}

/**
 * Reads auth-header configuration from env vars captured by api-connectivity-agent
 * during INTAKE Step 4b. Returns null when no token is configured (the request
 * proceeds without an Authorization header — useful in mock mode and on public
 * endpoints).
 *
 * Env var contract:
 * - NEXT_PUBLIC_API_AUTH_HEADER (default: "Authorization")
 * - NEXT_PUBLIC_API_AUTH_VALUE_PREFIX (default: "Bearer ", trailing space optional)
 * - NEXT_PUBLIC_API_TOKEN (the credential value)
 *
 * NEXT_PUBLIC_* vars are baked into the browser bundle. For production apps that
 * call a real backend with sensitive tokens, prefer a BFF or Next.js API route
 * proxy so tokens stay server-side. This helper is intended for local dev against
 * a dev backend where the convenience outweighs the exposure.
 */
export function getAuthHeader(): { name: string; value: string } | null {
  const token = process.env.NEXT_PUBLIC_API_TOKEN;
  if (!token) return null;

  const name = process.env.NEXT_PUBLIC_API_AUTH_HEADER || 'Authorization';
  const rawPrefix = process.env.NEXT_PUBLIC_API_AUTH_VALUE_PREFIX;
  const prefix =
    rawPrefix === undefined
      ? 'Bearer '
      : rawPrefix.length > 0 && !rawPrefix.endsWith(' ')
        ? `${rawPrefix} `
        : rawPrefix;

  return { name, value: `${prefix}${token}` };
}

/** The fields this API's error bodies can carry (all optional). */
interface ParsedErrorBody {
  /** The JSON body as received, or undefined when there was none / it wasn't JSON. */
  raw?: unknown;
  /** `ErrorResponse.message`, `UnauthenticatedResponse.message`, 409 `message`. */
  message?: string;
  /** `UnauthenticatedResponse.reason` (401). */
  reason?: string;
  /** `ValidationProblem.errors` (400; camelCase keys, `$` = whole body). */
  errors?: Record<string, string[]>;
  /** `ValidationProblem.title`. */
  title?: string;
  /** Legacy `DefaultResponse.Messages`. */
  legacyMessages?: string[];
  /** Legacy `DefaultResponse.MessageType`. */
  legacyMessageType?: string;
}

function isStringArrayRecord(
  value: unknown,
): value is Record<string, string[]> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (entry) =>
        Array.isArray(entry) && entry.every((item) => typeof item === 'string'),
    )
  );
}

/**
 * Reads a JSON error body (`application/json` or `application/problem+json`)
 * into the fields this API uses. Never throws.
 */
async function parseErrorBody(response: Response): Promise<ParsedErrorBody> {
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('json')) {
    return {};
  }

  try {
    const raw: unknown = await response.json();
    if (typeof raw !== 'object' || raw === null) {
      return { raw };
    }
    const data = raw as Record<string, unknown> & Partial<DefaultResponse>;
    return {
      raw,
      message: typeof data.message === 'string' ? data.message : undefined,
      reason: typeof data.reason === 'string' ? data.reason : undefined,
      errors: isStringArrayRecord(data.errors) ? data.errors : undefined,
      title: typeof data.title === 'string' ? data.title : undefined,
      legacyMessages:
        Array.isArray(data.Messages) && data.Messages.length > 0
          ? data.Messages
          : undefined,
      legacyMessageType:
        typeof data.MessageType === 'string' ? data.MessageType : undefined,
    };
  } catch {
    // Unparseable body: fall back to the status-based messages.
    return {};
  }
}

/** Status-based fallback messages when the body says nothing useful. */
const STATUS_MESSAGES: Partial<
  Record<HTTPStatusCode, { message: string; detail: string }>
> = {
  401: {
    message: 'Unauthorized: Please log in to continue',
    detail: 'Your session may have expired. Please log in again.',
  },
  403: {
    message: 'Forbidden: You do not have permission to perform this action',
    detail: 'Access denied.',
  },
  404: {
    message: 'Not Found: The requested resource does not exist',
    detail: 'Resource not found.',
  },
  500: {
    message: 'Internal Server Error: Something went wrong on the server',
    detail:
      'Please try again later or contact support if the problem persists.',
  },
};

/**
 * Builds the APIError for an error response from the API (shared with the
 * XMLHttpRequest uploader in ./upload.ts, so both throw the same shape).
 *
 * The APIError keeps the HTTP status and the parsed body so callers can
 * branch on them: `message` (ErrorResponse / 409), `reason` (401), `errors`
 * (400 ValidationProblem) and the raw `body`. A 502-504 from the same-origin
 * proxy means the back-end could not be reached and becomes the same
 * network error a failed fetch produces (statusCode 0).
 */
export async function apiErrorFromResponse(
  response: Response,
  url: string,
): Promise<APIError> {
  const statusCode = response.status as HTTPStatusCode;
  const parsed = await parseErrorBody(response);

  if (UNREACHABLE_STATUSES.includes(statusCode)) {
    return { ...createNetworkError(url), body: parsed.raw };
  }

  // Central 401 handling (BR4): the session has ended, so leave for sign-in
  // with the reason. `/auth/*` calls are excluded: a 401 from sign-in means
  // wrong credentials, and `/auth/me` callers decide for themselves.
  // The error is still thrown (so awaits and `finally` blocks settle), marked
  // `redirecting` so catch paths show nothing during the page load.
  const redirecting =
    statusCode === 401 && !isAuthEndpoint(url)
      ? redirectToSignIn(parsed.reason)
      : false;

  const validationMessages = parsed.errors
    ? Object.values(parsed.errors).flat()
    : [];
  const bodyDetails =
    parsed.legacyMessages ??
    (parsed.message
      ? [parsed.message]
      : validationMessages.length > 0
        ? validationMessages
        : []);

  const fallback = STATUS_MESSAGES[statusCode];
  const genericMessage = `HTTP ${statusCode}: ${response.statusText}`;
  const message =
    parsed.message ??
    fallback?.message ??
    parsed.legacyMessages?.[0] ??
    parsed.title ??
    (parsed.legacyMessageType
      ? `${parsed.legacyMessageType}: ${genericMessage}`
      : genericMessage);

  const error = createAPIError(
    message,
    statusCode,
    bodyDetails.length > 0
      ? bodyDetails
      : [fallback?.detail ?? `Request failed with status ${statusCode}`],
    url,
  );
  if (parsed.reason !== undefined) error.reason = parsed.reason;
  if (parsed.errors !== undefined) error.errors = parsed.errors;
  if (parsed.raw !== undefined) error.body = parsed.raw;
  if (redirecting) error.redirecting = true;

  return error;
}

/**
 * Handles successful API responses
 * Parses JSON or returns void for 204 No Content responses
 * For binary responses, returns a Blob
 */
async function handleSuccessResponse<T>(
  response: Response,
  isBinaryResponse?: boolean,
): Promise<T> {
  // Handle 204 No Content responses (e.g., DELETE operations)
  if (response.status === 204) {
    return undefined as T;
  }

  // If explicitly marked as binary response, always return blob
  if (isBinaryResponse) {
    return (await response.blob()) as T;
  }

  const contentType = response.headers.get('content-type');

  // Handle JSON responses
  if (contentType && contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  // Handle binary responses (e.g., file downloads)
  if (contentType && contentType.includes('application/octet-stream')) {
    return (await response.blob()) as T;
  }

  // Fallback: try to parse as JSON
  try {
    return (await response.json()) as T;
  } catch {
    // If JSON parsing fails, return undefined
    return undefined as T;
  }
}

/**
 * Creates a standardized APIError object
 */
function createAPIError(
  message: string,
  statusCode: number,
  details: string[],
  endpoint: string,
): APIError {
  return {
    message,
    statusCode,
    details,
    endpoint,
  };
}

/**
 * The error thrown when the back-end could not be reached (fetch threw, or the
 * proxy answered 502-504). statusCode 0 keeps it distinct from any HTTP refusal.
 */
export function createNetworkError(endpoint: string): APIError {
  return {
    ...createAPIError(
      'Network error: Unable to connect to the API server',
      0,
      ['Please check your internet connection and try again.'],
      endpoint,
    ),
    isNetworkError: true,
  };
}

/**
 * Sanitizes request body for safe logging by removing sensitive fields
 * Customize the sensitiveFields array based on your application's needs
 */
function sanitizeBodyForLogging(body: BodyInit | null): unknown {
  if (!body) {
    return null;
  }

  try {
    const parsed = JSON.parse(body as string);
    const sensitiveFields = [
      'password',
      'token',
      'apiKey',
      'secret',
      'creditCard',
      'ssn',
    ];

    // Create a sanitized copy
    const sanitized = { ...parsed };

    // Remove or mask sensitive fields
    Object.keys(sanitized).forEach((key) => {
      if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
        sanitized[key] = '***REDACTED***';
      }
    });

    return sanitized;
  } catch {
    return '[Unable to parse body]';
  }
}

/**
 * True for the authentication endpoints, whose request bodies (email and
 * password) are never logged, even redacted (BR12 / POPIA).
 */
function isAuthEndpoint(url: string): boolean {
  return /\/auth\//.test(url);
}

/**
 * Logs API request details in development mode
 * Automatically sanitizes sensitive fields for security
 */
function logRequest(url: string, method: string, body?: BodyInit | null): void {
  if (process.env.NODE_ENV === 'development') {
    console.group(`API Request: ${method} ${url}`);
    console.log('URL:', url);
    console.log('Method:', method);

    if (body && !isAuthEndpoint(url)) {
      console.log('Body:', sanitizeBodyForLogging(body));
    }

    console.groupEnd();
  }
}

/**
 * Logs API response details in development mode
 */
function logResponse(response: Response): void {
  if (process.env.NODE_ENV === 'development') {
    const statusEmoji = response.ok ? '✅' : '❌';
    console.log(
      `${statusEmoji} API Response: ${response.status} ${response.statusText}`,
    );
  }
}

interface ClientCallOptions {
  requiresAuth?: boolean;
}

/**
 * Convenience method for GET requests
 */
export async function get<T>(
  endpoint: string,
  params?: QueryParams,
  options?: ClientCallOptions,
): Promise<T> {
  return apiClient<T>(endpoint, {
    method: 'GET',
    params,
    requiresAuth: options?.requiresAuth,
  });
}

/**
 * Convenience method for POST requests
 */
export async function post<T>(
  endpoint: string,
  body?: unknown,
  lastChangedUser?: string,
  options?: ClientCallOptions,
): Promise<T> {
  return apiClient<T>(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
    lastChangedUser,
    requiresAuth: options?.requiresAuth,
  });
}

/**
 * Convenience method for PUT requests
 */
export async function put<T>(
  endpoint: string,
  body?: unknown,
  lastChangedUser?: string,
  options?: ClientCallOptions,
): Promise<T> {
  return apiClient<T>(endpoint, {
    method: 'PUT',
    body: JSON.stringify(body),
    lastChangedUser,
    requiresAuth: options?.requiresAuth,
  });
}

/**
 * Convenience method for DELETE requests
 */
export async function del<T>(
  endpoint: string,
  lastChangedUser?: string,
  options?: ClientCallOptions,
): Promise<T> {
  return apiClient<T>(endpoint, {
    method: 'DELETE',
    lastChangedUser,
    requiresAuth: options?.requiresAuth,
  });
}
