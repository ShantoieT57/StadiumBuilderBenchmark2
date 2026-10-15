'use client';

/**
 * ToastContainer - Container component for rendering toast notifications
 * Positioned at top-right of viewport, renders all active toasts
 * Manages stacking and positioning of multiple toasts. Each toast is its own
 * live region (status / alert), so the container itself is not one.
 */

import { useToast } from '@/contexts/ToastContext';
import { Toast } from './Toast';
import { ToastContainerProps } from '@/types/toast';

export function ToastContainer({
  position = 'top-right',
}: ToastContainerProps = {}) {
  const { toasts, dismissToast } = useToast();

  // Position classes based on prop
  const getPositionClasses = () => {
    switch (position) {
      case 'top-right':
        return 'top-4 right-4';
      case 'top-left':
        return 'top-4 left-4';
      case 'top-center':
        return 'top-4 left-1/2 -translate-x-1/2';
      case 'bottom-right':
        return 'bottom-4 right-4';
      case 'bottom-left':
        return 'bottom-4 left-4';
      case 'bottom-center':
        return 'bottom-4 left-1/2 -translate-x-1/2';
      default:
        return 'top-4 right-4';
    }
  };

  // The provider keeps the on-screen limit (TOAST_DEFAULTS.MAX_TOASTS), so
  // every message it holds is shown: a problem is never hidden here.
  const visibleToasts = toasts;

  if (visibleToasts.length === 0) {
    return null;
  }

  return (
    <div
      className={`fixed ${getPositionClasses()} z-50 flex flex-col gap-2 max-w-sm w-full px-4 sm:px-0 pointer-events-none`}
      role="region"
      aria-label="Notifications"
    >
      {visibleToasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </div>
  );
}
