'use client';

/**
 * Toast - one shared message (BR10). States its kind in words as well as
 * colour (NFR-5) and is announced: politely for success / info, assertively
 * for problems and warnings. The auto-dismiss timer lives in ToastContext.
 */

import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { TOAST_KIND_LABEL, ToastProps, ToastVariant } from '@/types/toast';

const DISMISS_LABEL = 'Dismiss message';

const VARIANT_STYLE: Record<
  ToastVariant,
  { border: string; text: string; Icon: typeof CircleCheck }
> = {
  success: {
    border: 'border-success',
    text: 'text-success',
    Icon: CircleCheck,
  },
  error: {
    border: 'border-destructive',
    text: 'text-destructive',
    Icon: CircleAlert,
  },
  warning: {
    border: 'border-warning',
    text: 'text-warning',
    Icon: TriangleAlert,
  },
  info: { border: 'border-primary', text: 'text-primary', Icon: Info },
};

export function Toast({ toast, onDismiss }: ToastProps) {
  const { border, text, Icon } = VARIANT_STYLE[toast.variant];
  const urgent = toast.variant === 'error' || toast.variant === 'warning';

  const handleToastClick = () => {
    if (toast.onClick) {
      toast.onClick();
      onDismiss(toast.id);
    }
  };

  return (
    <div
      className={cn(
        'bg-card text-card-foreground pointer-events-auto flex items-start gap-3 rounded-lg border border-l-4 p-4 shadow-lg',
        // Slide only (no opacity fade): the coloured kind label stays at full
        // contrast for its whole entrance, so it never dips below WCAG AA.
        'animate-in slide-in-from-right duration-300',
        border,
        toast.onClick && 'cursor-pointer transition-shadow hover:shadow-xl',
      )}
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      aria-atomic="true"
      onClick={toast.onClick ? handleToastClick : undefined}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-5 shrink-0', text)} />

      <div className="min-w-0 flex-1">
        <p
          className={cn('text-xs font-semibold uppercase tracking-wide', text)}
        >
          {TOAST_KIND_LABEL[toast.variant]}
        </p>
        <p className="text-sm font-semibold">{toast.title}</p>
        {toast.message && (
          <p className="text-muted-foreground mt-1 text-sm">{toast.message}</p>
        )}
      </div>

      {toast.dismissible && (
        // A label-only tooltip: it closes as soon as the pointer leaves the button.
        <TooltipProvider disableHoverableContent>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label={DISMISS_LABEL}
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(toast.id);
                }}
              >
                <X aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{DISMISS_LABEL}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
