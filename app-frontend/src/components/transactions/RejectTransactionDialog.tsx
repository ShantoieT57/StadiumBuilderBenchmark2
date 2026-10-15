'use client';

/**
 * "Reject" (R3-R5, R10-R14, BR4-BR6, BR9, BR10): the Approver's reject action with
 * its reason form.
 *
 * - The trigger reads "Reject" with the reference in a visually hidden suffix, so
 *   each row's button has its own accessible name.
 * - The form names the reference; focus starts in the required Reason field, stays
 *   inside while open and returns to the trigger on close. A counter shows the
 *   characters left (500 minus the trimmed length, counted as the server counts),
 *   or how many too many; the field is never hard-capped.
 * - "Reject" is unavailable while the trimmed reason is empty. The length rule is
 *   checked on leaving the field and on submit.
 * - Submitting sends `POST /transactions/{id}/reject` once with the trimmed reason;
 *   while it runs it reads "Rejecting…" and the field and both buttons are locked.
 * - 200: closes, "<reference> rejected." success message, `onSettled(details)`.
 * - 400: a problem keyed `reason` shows under the field; any other problem shows in
 *   one inline problem above the buttons. The form stays open with the reason kept.
 * - 409 (someone got there first): closes, persistent problem with the back-end's
 *   message and the current status, `onSettled(current details or null)`.
 * - Other failures keep the form open with an inline problem and "Try again"
 *   (403 shows the server's message).
 * The reason, account numbers and descriptions are never logged.
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import {
  decisionConflictOf,
  decisionConflictToast,
} from '@/components/transactions/decisionConflict';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/contexts/ToastContext';
import { rejectTransaction } from '@/lib/api/endpoints';
import {
  bodyMessageOf,
  isAPIError,
  isNetworkError,
  isRedirectingToSignIn,
  statusOf,
} from '@/lib/api/errors';
import {
  reasonCounterText,
  rejectReasonSchema,
  type RejectReasonValues,
} from '@/lib/validation/rejectReason';
import type { TransactionDetails } from '@/types/api-generated';

export const REJECT_LABEL = 'Reject';
export const REJECTING_LABEL = 'Rejecting…';
const REASON_FIELD = 'reason';
const REJECT_FAILED_TITLE = 'The transaction could not be rejected';
const REJECT_FAILED_MESSAGE =
  'Something went wrong while rejecting the transaction. Please try again.';
const UNREACHABLE_MESSAGE =
  "We can't reach the app right now. Check your connection and try again.";
/** The counter announces at most this often while the person types. */
const COUNTER_THROTTLE_MS = 300;

/** The form's title: "Reject <reference>?". */
export function rejectTransactionTitle(reference: string): string {
  return `Reject ${reference}?`;
}

/** The success message: "<reference> rejected.". */
export function transactionRejectedMessage(reference: string): string {
  return `${reference} rejected.`;
}

interface InlineProblem {
  message: string;
  /** Whether resending the same reason may help. */
  canRetry: boolean;
}

/** The inline problem for a failure that is not a refusal of what was sent. */
function inlineProblemOf(error: unknown): InlineProblem {
  if (isNetworkError(error)) {
    return { message: UNREACHABLE_MESSAGE, canRetry: true };
  }
  if (statusOf(error) === 403) {
    return {
      message: bodyMessageOf(error) ?? REJECT_FAILED_MESSAGE,
      canRetry: true,
    };
  }
  return { message: REJECT_FAILED_MESSAGE, canRetry: true };
}

/** A 400's problems split into the reason's and everything else's. */
function refusalOf(error: unknown): {
  reason: string[];
  other: string[];
} {
  const reason: string[] = [];
  const other: string[] = [];
  const errors = isAPIError(error) ? error.errors : undefined;
  for (const [key, messages] of Object.entries(errors ?? {})) {
    if (key.toLowerCase() === REASON_FIELD) reason.push(...messages);
    else other.push(...messages);
  }
  if (reason.length === 0 && other.length === 0) {
    other.push(bodyMessageOf(error) ?? REJECT_FAILED_MESSAGE);
  }
  return { reason, other };
}

/** `value`, updated at most once per `ms` (the last change always lands). */
function useThrottledValue<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  const lastShownAt = useRef(0);
  useEffect(() => {
    const wait = Math.max(lastShownAt.current + ms - Date.now(), 0);
    const timer = setTimeout(() => {
      lastShownAt.current = Date.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return shown;
}

function RejectReasonForm({
  transactionId,
  sendingRef,
  reasonRef,
  onClose,
  onSettled,
}: {
  transactionId: string;
  sendingRef: RefObject<boolean>;
  reasonRef: RefObject<HTMLTextAreaElement | null>;
  onClose: () => void;
  onSettled: (details: TransactionDetails | null) => void;
}) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<InlineProblem | null>(null);
  const lastSentRef = useRef('');
  const ids = {
    reason: useId(),
    counter: useId(),
    error: useId(),
  };

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<RejectReasonValues>({
    resolver: zodResolver(rejectReasonSchema),
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    defaultValues: { reason: '' },
  });

  const reason = useWatch({ control, name: REASON_FIELD });
  const counterText = useThrottledValue(
    reasonCounterText(reason),
    COUNTER_THROTTLE_MS,
  );
  const isEmpty = reason.trim().length === 0;
  const { ref: registerRef, ...reasonField } = register(REASON_FIELD);

  const send = (trimmed: string) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    lastSentRef.current = trimmed;
    setPending(true);
    setProblem(null);
    rejectTransaction(transactionId, { reason: trimmed }).then(
      (details) => {
        sendingRef.current = false;
        setPending(false);
        onClose();
        showToast({
          variant: 'success',
          title: transactionRejectedMessage(details.reference),
        });
        onSettled(details);
      },
      (error: unknown) => {
        sendingRef.current = false;
        setPending(false);
        if (isRedirectingToSignIn(error)) return;
        const conflict = decisionConflictOf(error);
        if (conflict) {
          onClose();
          showToast(decisionConflictToast(conflict));
          onSettled(conflict.transaction);
          return;
        }
        if (statusOf(error) === 400) {
          const refusal = refusalOf(error);
          if (refusal.reason.length > 0) {
            setError(REASON_FIELD, {
              type: 'server',
              message: refusal.reason.join(' '),
            });
          }
          if (refusal.other.length > 0) {
            setProblem({ message: refusal.other.join(' '), canRetry: false });
          }
          return;
        }
        setProblem(inlineProblemOf(error));
      },
    );
  };

  const reasonError = errors.reason?.message;
  const describedBy = reasonError ? `${ids.error} ${ids.counter}` : ids.counter;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void handleSubmit((values) => send(values.reason.trim()))(event);
      }}
      className="grid gap-4"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={ids.reason}>
          Reason
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        </Label>
        <Textarea
          id={ids.reason}
          required
          rows={4}
          disabled={pending}
          aria-invalid={reasonError ? true : undefined}
          aria-describedby={describedBy}
          {...reasonField}
          ref={(element) => {
            registerRef(element);
            reasonRef.current = element;
          }}
        />
        {reasonError && (
          <p id={ids.error} className="text-destructive text-sm">
            {reasonError}
          </p>
        )}
        <p
          id={ids.counter}
          aria-live="polite"
          className="text-muted-foreground text-sm"
        >
          {counterText}
        </p>
      </div>
      {problem !== null && (
        <Alert variant="destructive">
          <AlertTitle>{REJECT_FAILED_TITLE}</AlertTitle>
          <AlertDescription>
            <p>{problem.message}</p>
            {problem.canRetry && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => send(lastSentRef.current)}
                disabled={pending}
              >
                Try again
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending || isEmpty}>
          {pending ? REJECTING_LABEL : REJECT_LABEL}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function RejectTransactionDialog({
  transactionId,
  reference,
  onSettled,
}: {
  transactionId: string;
  reference: string;
  /**
   * Called after the back-end decided the transaction's fate: with the returned
   * details (rejected, or its current state after a conflict), or null when a
   * conflict did not say what the transaction is now.
   */
  onSettled: (details: TransactionDetails | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const sendingRef = useRef(false);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);

  const changeOpen = (next: boolean) => {
    // Locked while the reject is in progress.
    if (sendingRef.current) return;
    setOpen(next);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {/* The space sits outside the span: a span's own text is trimmed when
              the accessible name is computed. */}
          {`${REJECT_LABEL} `}
          <span className="sr-only">{reference}</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          reasonRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="break-all">
            {rejectTransactionTitle(reference)}
          </DialogTitle>
          <DialogDescription>
            This marks the transaction as Rejected and keeps your explanation
            with it. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <RejectReasonForm
          transactionId={transactionId}
          sendingRef={sendingRef}
          reasonRef={reasonRef}
          onClose={() => changeOpen(false)}
          onSettled={onSettled}
        />
      </DialogContent>
    </Dialog>
  );
}
