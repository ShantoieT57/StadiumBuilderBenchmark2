'use client';

/**
 * "Cancel file" (R4-R10, R17): the Importer's cancel action with its confirmation.
 *
 * - The trigger opens a confirmation naming the file, with "Keep file" as the
 *   default (focused) choice; "Keep file" / Escape close it with nothing sent.
 * - Confirming sends `POST /files/{id}/cancel` once; while it runs the confirm
 *   reads "Cancelling…" and both buttons are locked.
 * - 200 (also when someone else already cancelled it): closes, success message,
 *   and hands the returned details to `onCancelled`.
 * - 409 (refused): closes and shows the back-end's message as a persistent
 *   problem; `onRefused` lets the screen bring the file up to date.
 * - Other failures keep the dialog open with an inline problem and "Try again".
 * Messages name only the file (NFR-4).
 */

import { BanIcon } from 'lucide-react';
import { useRef, useState, type MouseEvent } from 'react';

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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useToast } from '@/contexts/ToastContext';
import { cancelFile } from '@/lib/api/endpoints';
import {
  bodyMessageOf,
  isAPIError,
  isNetworkError,
  isRedirectingToSignIn,
  statusOf,
} from '@/lib/api/errors';
import { failedOnInvalidRows } from '@/lib/format/file';
import type { FileDetails } from '@/types/api-generated';

export const CANCEL_FILE_LABEL = 'Cancel file';
export const KEEP_FILE_LABEL = 'Keep file';
export const CANCELLING_LABEL = 'Cancelling…';
const CANCEL_REFUSED_TITLE = 'The file could not be cancelled';
const CANCEL_FAILED_MESSAGE =
  'Something went wrong while cancelling the file. Please try again.';
const UNREACHABLE_MESSAGE =
  "We can't reach the app right now. Check your connection and try again.";

/** The confirmation's title: "Cancel <file name>?". */
export function cancelFileTitle(fileName: string): string {
  return `Cancel ${fileName}?`;
}

/** The success message: "<file name> has been cancelled.". */
export function fileCancelledMessage(fileName: string): string {
  return `${fileName} has been cancelled.`;
}

/** The server's own words for a refusal: its body `message`, else the error message. */
function serverMessageOf(error: unknown): string {
  if (!isAPIError(error)) return CANCEL_FAILED_MESSAGE;
  return (
    bodyMessageOf(error) ??
    (error.message.trim() !== '' ? error.message : CANCEL_FAILED_MESSAGE)
  );
}

/** The inline problem for a failure that keeps the dialog open. */
function inlineProblemOf(error: unknown): string {
  if (isNetworkError(error)) return UNREACHABLE_MESSAGE;
  if (statusOf(error) === 403) return serverMessageOf(error);
  return CANCEL_FAILED_MESSAGE;
}

export function CancelFileDialog({
  file,
  onCancelled,
  onRefused,
}: {
  file: FileDetails;
  /** Receives the details the back-end returned for the cancelled file. */
  onCancelled: (details: FileDetails) => void;
  /** Called after a refusal (409), so the screen can bring the file up to date. */
  onRefused?: () => void;
}) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const sendingRef = useRef(false);

  const changeOpen = (next: boolean) => {
    // Locked while the cancel is in progress.
    if (sendingRef.current) return;
    setOpen(next);
    if (!next) setProblem(null);
  };

  const send = () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setPending(true);
    setProblem(null);
    cancelFile(file.id).then(
      (details) => {
        sendingRef.current = false;
        setPending(false);
        setOpen(false);
        showToast({
          variant: 'success',
          title: fileCancelledMessage(details.fileName),
        });
        onCancelled(details);
      },
      (error: unknown) => {
        sendingRef.current = false;
        setPending(false);
        if (isRedirectingToSignIn(error)) return;
        if (statusOf(error) === 409) {
          setOpen(false);
          showToast({
            variant: 'error',
            title: CANCEL_REFUSED_TITLE,
            message: serverMessageOf(error),
          });
          onRefused?.();
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
        <Button
          type="button"
          variant="outline"
          className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <BanIcon aria-hidden="true" />
          {CANCEL_FILE_LABEL}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          keepRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="break-all">
            {cancelFileTitle(file.fileName)}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {`Its transactions will be removed and the original file will be discarded, so it can no longer be downloaded.${
              failedOnInvalidRows(file)
                ? ' It will no longer wait for corrections.'
                : ''
            } It will be hidden from the Dashboard unless cancelled files are shown.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {problem !== null && (
          <Alert variant="destructive">
            <AlertTitle>{CANCEL_REFUSED_TITLE}</AlertTitle>
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
          <AlertDialogCancel ref={keepRef} disabled={pending}>
            {KEEP_FILE_LABEL}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={confirm}
            disabled={pending}
          >
            {pending ? CANCELLING_LABEL : CANCEL_FILE_LABEL}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
