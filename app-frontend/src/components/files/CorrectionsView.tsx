'use client';

/**
 * Correct invalid rows (R1-R3, R12-R15, BR7, BR8, BR10, BR11, NFR-1..NFR-4).
 *
 * - Loads the file (`getFile`) and its invalid rows (`getInvalidRows`) from the
 *   browser; header with the file name, its status in words and "Back to file
 *   details".
 * - "Invalid rows" with "<N> rows still need correcting" (a `role=status` region),
 *   then one card per row: "Row <n>", every reason it failed, and its seven values
 *   in labelled fields (single column below md).
 * - One react-hook-form + zod form over every row, checked on blur and again on
 *   "Check again" (the back-end's reason wording).
 * - "Save changes" sends only the changed rows; "Check again" sends the rows
 *   changed since the last load or save (none is fine). Completed -> confirmation
 *   and the file's details; still Failed -> only the rows still failing.
 * - Server field problems (`corrections[i].field` / `rows[i].field`) land under
 *   the i-th sent row's field; anything else, and network failures (with
 *   "Try again", which resends the same request), show above the actions.
 * - Never logs row values or request bodies (NFR-4).
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type UseFormReturn } from 'react-hook-form';

import {
  FileCancelledBadge,
  FileStatusBadge,
} from '@/components/files/FileStatusBadge';
import { fileDetailsHref } from '@/components/files/FilesList';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/contexts/ToastContext';
import {
  getFile,
  getInvalidRows,
  recheckFile,
  saveCorrections,
} from '@/lib/api/endpoints';
import {
  isAPIError,
  isNetworkError,
  isRedirectingToSignIn,
  statusOf,
} from '@/lib/api/errors';
import {
  CORRECTION_FIELDS,
  correctionsSchema,
  type CorrectionField,
  type CorrectionRowValues,
  type CorrectionsValues,
} from '@/lib/validation/corrections';
import type {
  FileDetails,
  InvalidRow,
  InvalidRowList,
  RecheckResult,
  RowCorrection,
} from '@/types/api-generated';

export const CHANGES_SAVED_MESSAGE = 'Changes saved.';
export const NO_CHANGES_MESSAGE = 'No changes to save.';
const LOADING_MESSAGE = 'Loading invalid rows';
const LOAD_FAILED_TITLE = 'The invalid rows could not be loaded';
const REQUEST_FAILED_TITLE = 'Your changes were not sent';
const GENERIC_PROBLEM_MESSAGE = 'Something went wrong. Please try again.';
const UNREACHABLE_MESSAGE =
  "We can't reach the app right now. Check your connection and try again.";
export const FILE_NOT_FOUND_TITLE = 'File not found';

/** The confirmation once a check loads the file (R2). */
export function checkedAndLoadedMessage(fileName: string): string {
  return `${fileName} has been checked again and loaded.`;
}

/** "2 rows still need correcting" / "1 row still needs correcting". */
export function rowsStillNeedCorrecting(count: number): string {
  return count === 1
    ? '1 row still needs correcting'
    : `${count} rows still need correcting`;
}

const FIELD_LABELS: Record<CorrectionField, string> = {
  reference: 'Reference',
  transactionDate: 'Transaction date',
  accountNumber: 'Account number',
  description: 'Description',
  amount: 'Amount',
  transactionType: 'Transaction type',
  currency: 'Currency',
};

const REQUIRED_FIELDS: ReadonlySet<CorrectionField> = new Set([
  'transactionDate',
  'accountNumber',
  'amount',
  'transactionType',
]);

/** Statuses whose server message is shown as given (no retry: resending won't help). */
const REFUSAL_STATUSES: readonly number[] = [400, 403, 404, 409];

/** A request the Importer sent: kept so "Try again" resends exactly the same body. */
type CorrectionRequest =
  | { kind: 'save'; body: { rows: RowCorrection[] } }
  | { kind: 'check'; body: { corrections: RowCorrection[] } };

interface Problem {
  message: string;
  /** The request "Try again" resends; absent for refusals. */
  retry?: CorrectionRequest;
}

function valuesOf(row: InvalidRow): CorrectionRowValues {
  return {
    id: row.id,
    reference: row.reference,
    transactionDate: row.transactionDate,
    accountNumber: row.accountNumber,
    description: row.description,
    amount: row.amount,
    transactionType: row.transactionType,
    currency: row.currency,
  };
}

function toCorrection(values: CorrectionRowValues): RowCorrection {
  const correction: RowCorrection = {
    id: values.id,
    reference: '',
    transactionDate: '',
    accountNumber: '',
    description: '',
    amount: '',
    transactionType: '',
    currency: '',
  };
  for (const field of CORRECTION_FIELDS) {
    correction[field] = values[field] ?? '';
  }
  return correction;
}

function baselineOf(rows: InvalidRow[]): Map<string, CorrectionRowValues> {
  return new Map(rows.map((row) => [row.id, valuesOf(row)]));
}

function isChanged(
  values: CorrectionRowValues,
  baseline: Map<string, CorrectionRowValues>,
): boolean {
  const before = baseline.get(values.id);
  if (!before) return true;
  return CORRECTION_FIELDS.some((field) => values[field] !== before[field]);
}

/** The server's own words in an error body: its `message`, else every `errors` value. */
function serverWordsOf(error: unknown): string {
  if (!isAPIError(error)) return '';
  const body = error.body;
  if (typeof body === 'object' && body !== null) {
    const { message } = body as { message?: unknown };
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  const errors = error.errors;
  if (errors) {
    const words = Object.values(errors).flat().join(' ');
    if (words.trim() !== '') return words;
  }
  return error.message;
}

const FIELD_KEY_PATTERN = /^(?:corrections|rows)\[(\d+)\]\.([A-Za-z]+)$/;

function asCorrectionField(name: string): CorrectionField | null {
  const field = `${name.charAt(0).toLowerCase()}${name.slice(1)}`;
  return (CORRECTION_FIELDS as readonly string[]).includes(field)
    ? (field as CorrectionField)
    : null;
}

function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-destructive">
      *
    </span>
  );
}

/** "Back to file details". */
function BackToDetails({ fileId }: { fileId: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
      <Link href={fileDetailsHref(fileId)}>
        <ArrowLeftIcon aria-hidden="true" />
        Back to file details
      </Link>
    </Button>
  );
}

function CorrectionsHeader({ file }: { file: FileDetails }) {
  return (
    <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="text-2xl font-semibold break-all">{file.fileName}</h1>
        <div className="flex flex-wrap items-center gap-1">
          <FileStatusBadge status={file.status} />
          {file.isCancelled && <FileCancelledBadge />}
        </div>
      </div>
      {/* Header actions area: the importer's file actions on this screen. */}
      <div className="flex flex-wrap gap-2" data-slot="file-actions" />
    </header>
  );
}

/** One editable value of a row, with its problem linked by aria-describedby. */
function RowField({
  form,
  index,
  field,
  idPrefix,
}: {
  form: UseFormReturn<CorrectionsValues>;
  index: number;
  field: CorrectionField;
  idPrefix: string;
}) {
  const inputId = `${idPrefix}-${field}`;
  const errorId = `${inputId}-error`;
  const required = REQUIRED_FIELDS.has(field);
  const error = form.formState.errors.rows?.[index]?.[field];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={inputId}>
        {FIELD_LABELS[field]}
        {required && <RequiredMark />}
      </Label>
      <Input
        id={inputId}
        required={required}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...form.register(`rows.${index}.${field}`)}
      />
      {error?.message && (
        <p id={errorId} className="text-destructive text-sm">
          {error.message}
        </p>
      )}
    </div>
  );
}

/** One invalid row: its number, every reason it failed, and its seven values. */
function RowCard({
  row,
  index,
  form,
}: {
  row: InvalidRow;
  index: number;
  form: UseFormReturn<CorrectionsValues>;
}) {
  const id = useId();
  const headingId = `${id}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <h3 id={headingId} className="text-base font-semibold">
        Row {row.rowNumber}
      </h3>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-muted-foreground text-sm">Why it failed:</p>
        <ul className="text-destructive list-disc pl-5 text-sm">
          {row.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {CORRECTION_FIELDS.map((field) => (
          <RowField
            key={field}
            form={form}
            index={index}
            field={field}
            idPrefix={id}
          />
        ))}
      </div>
    </section>
  );
}

function CorrectionsForm({
  file,
  initialRows,
  onFileChange,
}: {
  file: FileDetails;
  initialRows: InvalidRowList;
  onFileChange: (file: FileDetails) => void;
}) {
  const fileId = file.id;
  const router = useRouter();
  const { showToast } = useToast();
  const [list, setList] = useState<InvalidRowList>(initialRows);
  const [pending, setPending] = useState<CorrectionRequest['kind'] | null>(
    null,
  );
  const [problem, setProblem] = useState<Problem | null>(null);
  // The values as last loaded or saved: what "changed" is measured against.
  const baselineRef = useRef(baselineOf(initialRows.rows));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const form = useForm<CorrectionsValues>({
    resolver: zodResolver(correctionsSchema),
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    defaultValues: { rows: initialRows.rows.map(valuesOf) },
  });

  /** Replaces the rows shown (and the form values) with `next`. */
  const showRows = (next: InvalidRowList) => {
    baselineRef.current = baselineOf(next.rows);
    setList(next);
    form.reset({ rows: next.rows.map(valuesOf) });
  };

  const changedCorrections = (): RowCorrection[] =>
    form
      .getValues()
      .rows.filter((values) => isChanged(values, baselineRef.current))
      .map(toCorrection);

  /** Puts a 400's field problems under the sent rows' fields; returns the rest. */
  const showFieldProblems = (
    request: CorrectionRequest,
    errors: Record<string, string[]>,
  ): string[] => {
    const sent =
      request.kind === 'save' ? request.body.rows : request.body.corrections;
    const formRows = form.getValues().rows;
    const unmapped: string[] = [];
    for (const [key, messages] of Object.entries(errors)) {
      const text = messages.join(' ');
      const match = FIELD_KEY_PATTERN.exec(key);
      const field = match ? asCorrectionField(match[2]) : null;
      const sentRow = match ? sent[Number(match[1])] : undefined;
      const index = sentRow
        ? formRows.findIndex((values) => values.id === sentRow.id)
        : -1;
      if (field && index >= 0) {
        form.setError(`rows.${index}.${field}`, {
          type: 'server',
          message: text,
        });
      } else {
        unmapped.push(text);
      }
    }
    return unmapped;
  };

  const handleFailure = (request: CorrectionRequest, error: unknown) => {
    if (isRedirectingToSignIn(error)) return;
    const status = statusOf(error);
    if (isNetworkError(error)) {
      setProblem({ message: UNREACHABLE_MESSAGE, retry: request });
      return;
    }
    if (status === 400 && isAPIError(error) && error.errors) {
      const unmapped = showFieldProblems(request, error.errors);
      if (unmapped.length > 0) setProblem({ message: unmapped.join(' ') });
      return;
    }
    if (status !== undefined && REFUSAL_STATUSES.includes(status)) {
      setProblem({
        message: serverWordsOf(error) || GENERIC_PROBLEM_MESSAGE,
      });
      return;
    }
    setProblem({ message: GENERIC_PROBLEM_MESSAGE, retry: request });
  };

  const handleCheckResult = (result: RecheckResult) => {
    if (result.status === 'Completed') {
      showToast({
        variant: 'success',
        title: checkedAndLoadedMessage(result.file.fileName),
      });
      // Stays locked while the details load.
      router.push(fileDetailsHref(fileId));
      return;
    }
    setPending(null);
    onFileChange(result.file);
    showRows(result.invalidRows);
    headingRef.current?.focus();
  };

  const send = (request: CorrectionRequest) => {
    setPending(request.kind);
    setProblem(null);
    if (request.kind === 'save') {
      saveCorrections(fileId, request.body).then(
        (saved) => {
          if (!aliveRef.current) return;
          setPending(null);
          showRows(saved);
          showToast({ variant: 'success', title: CHANGES_SAVED_MESSAGE });
        },
        (error: unknown) => {
          if (!aliveRef.current) return;
          setPending(null);
          handleFailure(request, error);
        },
      );
      return;
    }
    recheckFile(fileId, request.body).then(
      (result) => {
        if (!aliveRef.current) return;
        handleCheckResult(result);
      },
      (error: unknown) => {
        if (!aliveRef.current) return;
        setPending(null);
        handleFailure(request, error);
      },
    );
  };

  const save = () => {
    const rows = changedCorrections();
    if (rows.length === 0) {
      showToast({ variant: 'info', title: NO_CHANGES_MESSAGE });
      return;
    }
    send({ kind: 'save', body: { rows } });
  };

  const checkAgain = async () => {
    // Every field is checked, touched or not, and its problem shown (BR7).
    const valid = await form.trigger();
    if (!aliveRef.current) return;
    const corrections = changedCorrections();
    if (!valid) {
      // Only an edit that breaks a rule stops the check; rows left as they were
      // are already known to fail and the back-end says so.
      const parsed = correctionsSchema.safeParse(form.getValues());
      const badIndexes = new Set(
        parsed.success
          ? []
          : parsed.error.issues
              .map((issue) => issue.path[1])
              .filter((index): index is number => typeof index === 'number'),
      );
      const changedIds = new Set(corrections.map((row) => row.id));
      const rows = form.getValues().rows;
      const firstBad = rows.findIndex(
        (values, index) => badIndexes.has(index) && changedIds.has(values.id),
      );
      if (firstBad >= 0) {
        const issue = parsed.success
          ? undefined
          : parsed.error.issues.find((i) => i.path[1] === firstBad);
        const field = issue ? asCorrectionField(String(issue.path[2])) : null;
        if (field) form.setFocus(`rows.${firstBad}.${field}`);
        return;
      }
    }
    send({ kind: 'check', body: { corrections } });
  };

  return (
    <form
      noValidate
      className="flex min-w-0 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void checkAgain();
      }}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold outline-none"
        >
          Invalid rows
        </h2>
        <p role="status" className="text-muted-foreground">
          {rowsStillNeedCorrecting(list.totalCount)}
        </p>
        <p className="text-muted-foreground text-sm">
          Fields marked <RequiredMark /> are required.
        </p>
      </div>

      {list.rows.map((row, index) => (
        <RowCard key={row.id} row={row} index={index} form={form} />
      ))}

      {problem && (
        <Alert variant="destructive">
          <AlertTitle>{REQUEST_FAILED_TITLE}</AlertTitle>
          <AlertDescription>
            <p>{problem.message}</p>
            {problem.retry && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  if (problem.retry) send(problem.retry);
                }}
              >
                Try again
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending !== null}>
          {pending === 'check' ? 'Checking…' : 'Check again'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending !== null}
          onClick={save}
        >
          {pending === 'save' ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

interface Loaded {
  file: FileDetails;
  rows: InvalidRowList;
}

export function CorrectionsView({ fileId }: { fileId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const requestRef = useRef(0);

  // State is only set from the promise callbacks, never synchronously in an effect.
  const load = useCallback((): Promise<void> => {
    const request = ++requestRef.current;
    return Promise.all([getFile(fileId), getInvalidRows(fileId)]).then(
      ([file, rows]) => {
        if (request !== requestRef.current) return;
        setLoaded({ file, rows });
        setFailure(null);
      },
      (error: unknown) => {
        if (request !== requestRef.current) return;
        if (isRedirectingToSignIn(error)) return;
        setFailure(error ?? new Error('Load failed'));
      },
    );
  }, [fileId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Ignore answers that arrive after the screen has gone.
  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    [],
  );

  const retry = () => {
    setFailure(null);
    void load();
  };

  const changeFile = useCallback((file: FileDetails) => {
    setLoaded((current) => (current ? { ...current, file } : current));
  }, []);

  let content: ReactNode;
  if (loaded !== null) {
    content = (
      <>
        <CorrectionsHeader file={loaded.file} />
        <CorrectionsForm
          file={loaded.file}
          initialRows={loaded.rows}
          onFileChange={changeFile}
        />
      </>
    );
  } else if (failure !== null && statusOf(failure) === 404) {
    content = (
      <>
        <h1 className="text-2xl font-semibold">{FILE_NOT_FOUND_TITLE}</h1>
        <p className="text-muted-foreground">
          This file does not exist or is no longer available.
        </p>
      </>
    );
  } else if (failure !== null) {
    const message = isNetworkError(failure)
      ? UNREACHABLE_MESSAGE
      : serverWordsOf(failure) || GENERIC_PROBLEM_MESSAGE;
    content = (
      <>
        <h1 className="text-2xl font-semibold">Corrections</h1>
        <Alert variant="destructive">
          <AlertTitle>{LOAD_FAILED_TITLE}</AlertTitle>
          <AlertDescription>
            <p>{message}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={retry}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </>
    );
  } else {
    content = (
      <>
        <h1 className="text-2xl font-semibold">Corrections</h1>
        <p role="status" className="text-muted-foreground">
          {LOADING_MESSAGE}…
        </p>
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <BackToDetails fileId={fileId} />
      {content}
    </div>
  );
}
