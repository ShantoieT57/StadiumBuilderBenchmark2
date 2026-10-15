/**
 * Application Constants Template
 *
 * Define your application-specific constants here
 * Examples include API configuration, UI settings, and business logic constants
 */

/**
 * API base URL used by the browser-side API client.
 *
 * Always the same-origin `/api` proxy (src/app/api/[...path]/route.ts): the
 * back-end sends no CORS headers, so the browser must never call it directly.
 * The real back-end address is the server-only `BACKEND_URL` env var
 * (see src/lib/server/backend.ts) and is deliberately NOT configurable here.
 */
export const API_BASE_URL = '/api';

/**
 * Default pagination settings
 * Customize based on your application's needs
 */
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 25,
  PAGE_SIZE_OPTIONS: [10, 25, 50, 100],
} as const;

/**
 * Toast notification settings
 */
export const TOAST_SETTINGS = {
  DEFAULT_DURATION: 5000, // 5 seconds
  SUCCESS_DURATION: 3000, // 3 seconds
  ERROR_DURATION: 7000, // 7 seconds
  MAX_TOASTS: 3,
} as const;

/**
 * Modal settings
 */
export const MODAL_SETTINGS = {
  ANIMATION_DURATION: 150, // 150ms for enter/exit animations
} as const;

// Add your application-specific constants below
// Example:
// export const DATE_FORMATS = {
//   DISPLAY: 'dd MMM yyyy',
//   API: 'yyyy-MM-dd',
// } as const;
