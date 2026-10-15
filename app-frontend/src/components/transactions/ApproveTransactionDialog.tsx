'use client';

/**
 * "Approve" (R6-R9, BR3, BR6): the Approver's approve action with its confirmation.
 *
 * - The trigger reads "Approve" with the reference in a visually hidden suffix, so
 *   each row's button has its own accessible name.
 * - The confirmation names the reference, with "Cancel" as the default (focused)
 *   choice; Cancel / Escape close it with nothing sent and focus back on the trigger.
 * - Confirming sends `POST /transactions/{id}/approve` once; while it runs the
 *   confirm reads "Approving…" and both buttons are locked.
 * - 200: closes, "<reference> approved." success message, `onSettled(details)`.
 * - 409 (someone got there first): closes, persistent problem with the back-end's
 *   message and the current status, `onSettled(current details or null)`.
 * - After a decision (200 or 409) focus is left to the list (the row leaves
 *   Imported, so the trigger goes); Cancel / Escape still return it to the trigger.
 * - Other failures keep the dialog open with an inline problem and "Try again"
 *   (403 shows the server's message).
 * Messages name only the reference and status; nothing is logged.
 */

import { useRef, useState, type MouseEvent } from 'react';

import {
  decisionConflictOf,
  decisionConflictToast,
} from '@/components/transactions/decisionConflict';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/contexts/ToastContext';
import { approveTransaction } from '@/lib/api/endpoints';
import {
  bodyMessageOf,
  isNetworkError,
  isRedirectingToSignIn,
  statusOf,
} from '@/lib/api/errors';
import type { TransactionDetails } from '@/types/api-generated';

export const APPROVE_LABEL = 'Approve';
export const APPROVING_LABEL = 'Approving…';
const APPROVE_FAILED_TITLE = 'The transaction could not be approved';
const APPROVE_FAILED_MESSAGE =
  'Something went wrong while approving the transaction. Please try again.';
const UNREACHABLE_MESSAGE =
  "We can't reach the app right now. Check your connection and try again.";

/** The confirmation's title: "Approve <reference>?". */
export function approveTransactionTitle(reference: string): string {
  return `Approve ${reference}?`;
}

/** The success message: "<reference> approved.". */
export function transactionApprovedMessage(reference: string): string {
  return `${reference} approved.`;
}

/** The inline problem for a failure that keeps the dialog open. */
function inlineProblemOf(error: unknown): string {
  if (isNetworkError(error)) return UNREACHABLE_MESSAGE;
  if (statusOf(error) === 403) {
    return bodyMessageOf(error) ?? APPROVE_FAILED_MESSAGE;
  }
  return APPROVE_FAILED_MESSAGE;
}

export function ApproveTransactionDialog({
  transactionId,
  reference,
  onSettled,
}: {
  transactionId: string;
  reference: string;
  /**
   * Called after the back-end decided the transaction's fate: with the returned
   * details (approved, or its current state after a conflict), or null when a
   * conflict did not say what the transaction is now.
   */
  onSettled: (details: TransactionDetails | null) => void;
}) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const sendingRef = useRef(false);
  // Set once the back-end has decided, so closing does not refocus the trigger.
  const decidedRef = useRef(false);

  const changeOpen = (next: boolean) => {
    // Locked while the approve is in progress.
    if (sendingRef.current) return;
    if (next) decidedRef.current = false;
    setOpen(next);
    if (!next) setProblem(null);
  };

  const settle = (details: TransactionDetails | null) => {
    decidedRef.current = true;
    onSettled(details);
  };

  const send = () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setPending(true);
    setProblem(null);
    approveTransaction(transactionId).then(
      (details) => {
        sendingRef.current = false;
        setPending(false);
        setOpen(false);
        showToast({
          variant: 'success',
          title: transactionApprovedMessage(details.reference),
        });
        settle(details);
      },
      (error: unknown) => {
        sendingRef.current = false;
        setPending(false);
        if (isRedirectingToSignIn(error)) return;
        const conflict = decisionConflictOf(error);
        if (conflict) {
          setOpen(false);
          showToast(decisionConflictToast(conflict));
          settle(conflict.transaction);
          return;
        }
        setProblem(inlineProblemOf(error));
      },
    );
  };

  const confirm = (event: MouseEvent<HTMLButtonElement>) => {
    // The dialog stays open until the back-end answers.
    event.preventDefault();
    send();
  };

  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogTrigger asChild>
        {/* The reference is in aria-label, not an sr-only span, so it is not
            page text (the table's reference cells stay the only match). The
            visible text starts the name (WCAG 2.5.3 label-in-name). */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`${APPROVE_LABEL} ${reference}`}
        >
          {APPROVE_LABEL}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (decidedRef.current) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="break-all">
            {approveTransactionTitle(reference)}
          </AlertDialogTitle>
          <AlertDialogDescription>
            This marks the transaction as Approved. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {problem !== null && (
          <Alert variant="destructive">
            <AlertTitle>{APPROVE_FAILED_TITLE}</AlertTitle>
            <AlertDescription>
              <p>{problem}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={send}
                disabled={pending}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={pending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={pending}>
            {pending ? APPROVING_LABEL : APPROVE_LABEL}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
