/**
 * Shared message (toast) type definitions — the app's single success / problem
 * message mechanism (BR10).
 */

/**
 * ToastVariant - Available message kinds.
 * `error` is a "Problem": it never auto-dismisses and is announced assertively.
 */
export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

/**
 * Toast - Individual message object
 */
export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
  /** Auto-dismiss delay in ms; 0 = stays until dismissed. Always 0 for problems. */
  duration: number;
  /** Whether the person can dismiss it. Always true for problems. */
  dismissible: boolean;
  onClick?: () => void; // Optional click handler for interactive messages
}

/**
 * ToastOptions - Options for raising a new message via showToast
 */
export interface ToastOptions {
  variant: ToastVariant;
  title: string;
  message?: string;
  /** Ignored for problems (`error`), which never auto-dismiss. */
  duration?: number;
  /** Ignored for problems (`error`), which can always be dismissed. */
  dismissible?: boolean;
  onClick?: () => void;
}

/**
 * ToastContextValue - Context value for the provider
 */
export interface ToastContextValue {
  toasts: Toast[];
  /** Raises a message and returns its id (pass it to dismissToast once the problem is resolved). */
  showToast: (options: ToastOptions) => string;
  dismissToast: (id: string) => void;
  clearAllToasts: () => void;
}

/**
 * ToastProps - Props for an individual Toast component
 */
export interface ToastProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

/**
 * ToastContainerProps - Props for ToastContainer component
 */
export interface ToastContainerProps {
  position?:
    | 'top-right'
    | 'top-left'
    | 'bottom-right'
    | 'bottom-left'
    | 'top-center'
    | 'bottom-center';
  maxToasts?: number; // Maximum number of messages to display at once (default: 3)
}

/**
 * Default message configuration values
 */
export const TOAST_DEFAULTS = {
  /** Auto-dismiss delay for success / info / warning messages. */
  DURATION: 5000, // 5 seconds
  MAX_TOASTS: 3,
  POSITION: 'top-right' as const,
  DISMISSIBLE: true,
} as const;

/** The visible word stating each message's kind (NFR-5: words, not only colour). */
export const TOAST_KIND_LABEL: Record<ToastVariant, string> = {
  success: 'Success',
  error: 'Problem',
  warning: 'Warning',
  info: 'Information',
};

/** Problems never auto-dismiss (BR10). */
export function isProblem(variant: ToastVariant): boolean {
  return variant === 'error';
}
