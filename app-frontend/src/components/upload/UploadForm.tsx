'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { FileTextIcon, UploadIcon, XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { fileDetailsHref } from '@/components/files/FilesList';
import { useToast } from '@/contexts/ToastContext';
import {
  isAPIError,
  isNetworkError,
  isRedirectingToSignIn,
  statusOf,
} from '@/lib/api/errors';
import { uploadFile, type UploadResult } from '@/lib/api/upload';
import {
  dashboardListHref,
  rememberedFileListSearch,
} from '@/lib/files/listReturn';
import { formatFileSize } from '@/lib/format/file';
import { uploadRefusal } from '@/lib/validation/upload';
import { cn } from '@/lib/utils';
import type { FileKind } from '@/types/api-generated';

/** Shown under the file field when Upload is selected with no file chosen (BR8). */
export const CHOOSE_A_FILE_MESSAGE = 'Choose a file to upload.';

/** An unexpected server problem (not one of the known refusals); offers Try again. */
export const UPLOAD_FAILED_MESSAGE = 'The file could not be uploaded.';

/** The connection dropped part way (network error, abort, proxy 502-504) (R6). */
export function uploadInterruptedMessage(fileName: string): string {
  return `The upload of ${fileName} failed. Check your connection and try again.`;
}

/** Statuses whose server message is shown word for word (BR3). */
const REFUSAL_STATUSES: readonly number[] = [400, 403, 413, 415];

/**
 * What the field shows after a failed upload. A refusal clears the file; a
 * failure keeps it so "Try again" re-sends it.
 */
interface UploadProblem {
  message: string;
  /** The file "Try again" re-sends; absent for refusals. */
  retry?: File;
}

/**
 * The server's own words in a JSON error body, in the API client's priority:
 * its `message`, else every ValidationProblem `errors` value; '' when the body
 * carried neither (or there was no body).
 */
function serverWordsOf(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const { message, errors } = body as { message?: unknown; errors?: unknown };
  if (typeof message === 'string' && message.trim() !== '') return message;
  if (typeof errors !== 'object' || errors === null) return '';
  return Object.values(errors)
    .flat()
    .filter((entry): entry is string => typeof entry === 'string')
    .join(' ');
}

/** Turns a rejected upload into the field's problem (BR3, R6). Names the file only (NFR-4). */
function problemFor(error: unknown, chosen: File): UploadProblem {
  if (isNetworkError(error)) {
    return { message: uploadInterruptedMessage(chosen.name), retry: chosen };
  }
  const status = statusOf(error);
  if (
    isAPIError(error) &&
    status !== undefined &&
    REFUSAL_STATUSES.includes(status)
  ) {
    // One source - the body as received. `error.message` / `details` may be the
    // client's status fallback (e.g. "HTTP 413: ") when the body said nothing.
    const message = serverWordsOf(error.body);
    if (message.trim() !== '') return { message };
  }
  return { message: UPLOAD_FAILED_MESSAGE, retry: chosen };
}

const KIND_OPTIONS: readonly { value: FileKind; label: string }[] = [
  { value: 'BankTransactions', label: 'Bank transactions' },
];

const DEFAULT_KIND: FileKind = 'BankTransactions';

function isFileKind(value: string): value is FileKind {
  return KIND_OPTIONS.some((option) => option.value === value);
}

/** The success confirmation (R5); the toast auto-dismisses (BR7). */
function uploadedMessage(fileName: string): string {
  return `${fileName} has been uploaded successfully.`;
}

function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-destructive">
      *
    </span>
  );
}

const noSubscription = () => () => {};

/** "Last upload": the file just sent, with links to follow its processing (R7). */
function LastUpload({ uploaded }: { uploaded: UploadResult }) {
  const search = useSyncExternalStore(
    noSubscription,
    rememberedFileListSearch,
    () => '',
  );
  return (
    <section
      aria-labelledby="last-upload-heading"
      className="flex min-w-0 flex-col gap-2 rounded-md border p-4 text-sm"
    >
      <h2 id="last-upload-heading" className="font-medium">
        Last upload
      </h2>
      <p className="break-all">{uploaded.fileName}</p>
      <div className="flex flex-wrap gap-2">
        {/* No id when the server's answer had no readable body: nothing to link to. */}
        {uploaded.id !== undefined && (
          <Button asChild variant="outline" size="sm">
            <Link href={fileDetailsHref(uploaded.id)}>View file details</Link>
          </Button>
        )}
        <Button asChild variant="ghost" size="sm">
          <Link href={dashboardListHref(search)}>Go to dashboard</Link>
        </Button>
      </div>
    </section>
  );
}

/**
 * The Importer's upload form (UP-01, UP-02, UP-05): a drop area with a
 * keyboard-operable "Choose file" button, the kind of file (preselected), and
 * Upload with progress and an announced start and finish. The file's contents
 * are never read; only its name and size are shown (NFR-4).
 */
export function UploadForm() {
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadAbort = useRef<AbortController | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<FileKind>(DEFAULT_KIND);
  const [problem, setProblem] = useState<UploadProblem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [lastUpload, setLastUpload] = useState<UploadResult | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const id = useId();
  const inputId = `${id}-file`;
  const kindId = `${id}-kind`;
  const errorId = `${id}-file-error`;
  const hintId = `${id}-file-hint`;

  // Leaving the screen cancels an upload still in progress.
  useEffect(() => () => uploadAbort.current?.abort(), []);

  /**
   * A file was chosen or dropped. Several files, a non-.csv file or an invalid
   * name are refused before any request, and the refused file is cleared (BR2).
   */
  const chooseFiles = (files: File[]) => {
    if (files.length === 0) return;
    const refusal = uploadRefusal(files.map((chosen) => chosen.name));
    if (refusal) {
      setFile(null);
      setProblem({ message: refusal });
      return;
    }
    setFile(files[0]);
    setProblem(null);
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    chooseFiles(Array.from(event.target.files ?? []));
    // Cleared so choosing the same file again still counts as a choice.
    event.target.value = '';
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (uploading) {
      event.dataTransfer.dropEffect = 'none';
      return;
    }
    event.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDragActive(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    // One upload at a time (BR4): a drop while uploading is ignored.
    if (uploading) return;
    chooseFiles(Array.from(event.dataTransfer?.files ?? []));
  };

  const removeFile = () => {
    setFile(null);
    setProblem(null);
  };

  const startUpload = async (chosen: File) => {
    const controller = new AbortController();
    uploadAbort.current = controller;
    setUploading(true);
    setProgress(0);
    setProblem(null);
    setAnnouncement(`Uploading ${chosen.name}`);

    try {
      const uploaded = await uploadFile(chosen, kind, {
        onProgress: setProgress,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      showToast({
        variant: 'success',
        title: uploadedMessage(uploaded.fileName),
      });
      setLastUpload(uploaded);
      setFile(null);
      setAnnouncement(`Upload finished: ${uploaded.fileName} uploaded.`);
    } catch (error) {
      if (controller.signal.aborted || isRedirectingToSignIn(error)) return;
      setAnnouncement('');
      const next = problemFor(error, chosen);
      // A refused file is cleared so the Importer chooses again; a failed one is kept.
      setFile(next.retry ?? null);
      setProblem(next);
    } finally {
      if (uploadAbort.current === controller) uploadAbort.current = null;
      if (!controller.signal.aborted) {
        setUploading(false);
        setProgress(0);
      }
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (uploading) return;
    if (!file) {
      setProblem({ message: CHOOSE_A_FILE_MESSAGE });
      return;
    }
    void startUpload(file);
  };

  const tryAgain = () => {
    if (uploading || !problem?.retry) return;
    void startUpload(problem.retry);
  };

  const fieldError = problem?.message ?? null;
  const describedBy = [hintId, fieldError ? errorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex w-full max-w-2xl min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Upload</h1>
        <p className="text-muted-foreground">
          Upload the daily bank transactions file. Its processing can be
          followed on the file&apos;s details and the Dashboard.
        </p>
      </div>

      <form
        noValidate
        onSubmit={onSubmit}
        aria-label="Upload a file"
        className="flex min-w-0 flex-col gap-6"
      >
        <p className="text-sm text-muted-foreground">
          Fields marked <RequiredMark /> are required.
        </p>

        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={inputId}>
            File to upload <RequiredMark />
          </Label>
          <div
            data-testid="upload-drop-area"
            onDragEnter={onDragOver}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={cn(
              'flex min-w-0 flex-col items-center gap-3 rounded-lg border-2 border-dashed border-input p-6 text-center transition-colors',
              dragActive && 'border-primary bg-accent',
            )}
          >
            <UploadIcon
              aria-hidden="true"
              className="size-8 text-muted-foreground"
            />
            <p className="text-sm">Drag a file here, or</p>
            <Button
              type="button"
              variant="outline"
              disabled={uploading}
              aria-describedby={describedBy}
              onClick={() => inputRef.current?.click()}
            >
              Choose file
            </Button>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept=".csv"
              required
              tabIndex={-1}
              disabled={uploading}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={describedBy}
              onChange={onInputChange}
              className="sr-only"
            />
            <p id={hintId} className="text-xs text-muted-foreground">
              One .csv file at a time.
            </p>
          </div>

          {file && (
            <div className="flex min-w-0 items-start gap-3 rounded-md border p-3">
              <FileTextIcon
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-muted-foreground"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-sm font-medium break-all">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(file.size)}
                </p>
              </div>
              <TooltipProvider disableHoverableContent>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      aria-label={`Remove ${file.name}`}
                      disabled={uploading}
                      onClick={removeFile}
                    >
                      <XIcon aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Remove file</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}

          {problem && (
            <div className="flex min-w-0 flex-col items-start gap-2">
              <p
                id={errorId}
                role="alert"
                className="text-sm break-words text-destructive"
              >
                {problem.message}
              </p>
              {problem.retry && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={tryAgain}
                >
                  Try again
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={kindId}>
            Kind of file <RequiredMark />
          </Label>
          <Select
            value={kind}
            onValueChange={(value) => {
              if (isFileKind(value)) setKind(value);
            }}
            required
            disabled={uploading}
          >
            <SelectTrigger id={kindId} className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KIND_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {uploading && file && (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 items-start justify-between gap-3 text-sm">
              <p className="min-w-0 break-all">Uploading {file.name}…</p>
              <p className="shrink-0 tabular-nums">{progress}%</p>
            </div>
            <Progress value={progress} aria-label="Upload progress" />
          </div>
        )}

        {/* Announces the start and finish only, not every percent (NFR-3). */}
        <p role="status" className="sr-only">
          {announcement}
        </p>

        <div>
          <Button type="submit" disabled={uploading}>
            Upload
          </Button>
        </div>
      </form>

      {lastUpload && <LastUpload uploaded={lastUpload} />}
    </div>
  );
}
