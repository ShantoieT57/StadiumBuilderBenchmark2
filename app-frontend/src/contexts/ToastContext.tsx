'use client';

/**
 * ToastContext - the app's single shared message mechanism (BR10).
 *
 * Owns the one auto-dismiss timer per message: success / info / warning
 * messages close themselves after their duration; problems (`error`) never
 * do — they stay until the person dismisses them or the caller dismisses
 * them (by id) once the problem is resolved.
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  ReactNode,
} from 'react';
import {
  Toast,
  ToastOptions,
  ToastContextValue,
  TOAST_DEFAULTS,
  isProblem,
} from '@/types/toast';

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

/**
 * Keeps at most MAX_TOASTS messages by dropping the oldest auto-dismissing
 * ones, never the message just added (`newId`) and never a problem. When only
 * problems and the new message are left, the limit is exceeded instead, so
 * neither a problem nor the message just raised is lost.
 */
function trimToLimit(toasts: Toast[], newId: string): Toast[] {
  const result = [...toasts];
  while (result.length > TOAST_DEFAULTS.MAX_TOASTS) {
    const oldestTransient = result.findIndex(
      (t) => t.id !== newId && !isProblem(t.variant),
    );
    if (oldestTransient === -1) break;
    result.splice(oldestTransient, 1);
  }
  return result;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // The single timer per message lives here (not in the Toast component).
  const timeoutRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  useEffect(() => {
    const currentTimeoutRefs = timeoutRefs.current;
    return () => {
      currentTimeoutRefs.forEach((timeoutId) => clearTimeout(timeoutId));
      currentTimeoutRefs.clear();
    };
  }, []);

  const clearTimer = useCallback((id: string) => {
    const timeoutId = timeoutRefs.current.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutRefs.current.delete(id);
    }
  }, []);

  const dismissToast = useCallback(
    (id: string) => {
      setToasts((prevToasts) => prevToasts.filter((toast) => toast.id !== id));
      clearTimer(id);
    },
    [clearTimer],
  );

  const showToast = useCallback(
    (options: ToastOptions) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const problem = isProblem(options.variant);

      const newToast: Toast = {
        id,
        variant: options.variant,
        title: options.title,
        message: options.message,
        duration: problem ? 0 : (options.duration ?? TOAST_DEFAULTS.DURATION),
        dismissible: problem
          ? true
          : (options.dismissible ?? TOAST_DEFAULTS.DISMISSIBLE),
        onClick: options.onClick,
      };

      setToasts((prevToasts) => {
        const updated = trimToLimit([...prevToasts, newToast], id);
        // Release timers of any messages trimmed away.
        prevToasts
          .filter((t) => !updated.includes(t))
          .forEach((t) => clearTimer(t.id));
        return updated;
      });

      if (newToast.duration > 0) {
        timeoutRefs.current.set(
          id,
          setTimeout(() => dismissToast(id), newToast.duration),
        );
      }

      return id;
    },
    [dismissToast, clearTimer],
  );

  const clearAllToasts = useCallback(() => {
    setToasts([]);
    timeoutRefs.current.forEach((timeoutId) => clearTimeout(timeoutId));
    timeoutRefs.current.clear();
  }, []);

  const value: ToastContextValue = {
    toasts,
    showToast,
    dismissToast,
    clearAllToasts,
  };

  return (
    <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
  );
}

/**
 * useToast - access the shared message mechanism.
 * @throws Error if used outside of ToastProvider
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);

  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }

  return context;
}
