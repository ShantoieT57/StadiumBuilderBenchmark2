'use client';

/**
 * Transaction details (TL-06, R4, R10, R11).
 *
 * - Every TransactionDetails field as a description list (`<dt>` label, `<dd>` value).
 * - The rejection reason is read-only text, shown only for a Rejected transaction.
 * - Loading, problem + Retry (reloads in place) and not-found (404) states (NFR-2).
 * - No Approve / Reject / Export controls in this epic (BR6).
 * - Account numbers and descriptions are never logged (BR8).
 */

import Link from 'next/link';
import { ArrowLeftIcon } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { TransactionStatusBadge } from '@/components/transactions/TransactionStatusBadge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { getTransaction } from '@/lib/api/endpoints';
import {
  isNetworkError,
  isRedirectingToSignIn,
  statusOf,
} from '@/lib/api/errors';
import {
  formatAmount,
  formatLocalDateTime,
  formatTransactionDate,
  formatTransactionType,
} from '@/lib/format/transaction';
import {
  rememberedListSearch,
  transactionsListHref,
} from '@/lib/transactions/listReturn';
import type { TransactionDetails } from '@/types/api-generated';

export const LOADING_TRANSACTION_MESSAGE = 'Loading transaction';
export const TRANSACTION_NOT_FOUND_MESSAGE = 'Transaction not found';
const LOAD_FAILED_TITLE = 'The transaction could not be loaded';
const LOAD_FAILED_MESSAGE = 'Something went wrong. Please try again.';
const UNREACHABLE_MESSAGE =
  "We can't reach the app right now. Check your connection and try again.";
const NO_REASON_RECORDED = 'No reason recorded';

const noSubscription = () => () => {};

/** "Back to transactions", returning to the list view remembered for this tab. */
function BackToTransactions() {
  const search = useSyncExternalStore(
    noSubscription,
    rememberedListSearch,
    () => '',
  );
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
      <Link href={transactionsListHref(search)}>
        <ArrowLeftIcon aria-hidden="true" />
        Back to transactions
      </Link>
    </Button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="text-muted-foreground text-sm font-medium sm:w-40 sm:shrink-0">
        {label}
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function DetailsList({ details }: { details: TransactionDetails }) {
  return (
    <dl className="flex min-w-0 flex-col gap-3 rounded-lg border p-4">
      <Field label="Reference">{details.reference}</Field>
      <Field label="Transaction date">
        {formatTransactionDate(details.transactionDate)}
      </Field>
      <Field label="Account number">{details.accountNumber}</Field>
      <Field label="Description">{details.description}</Field>
      <Field label="Amount">
        <span className="tabular-nums">
          {formatAmount(details.amount, details.currency)}
        </span>
      </Field>
      <Field label="Type">
        {formatTransactionType(details.transactionType)}
      </Field>
      <Field label="Status">
        <TransactionStatusBadge status={details.status} />
      </Field>
      <Field label="File">{details.file.fileName}</Field>
      <Field label="Created by">{details.createdBy}</Field>
      <Field label="Created on">{formatLocalDateTime(details.createdAt)}</Field>
      <Field label="Last changed by">{details.lastChangedBy}</Field>
      <Field label="Last changed on">
        {formatLocalDateTime(details.lastChangedAt)}
      </Field>
      {details.status === 'Rejected' ? (
        <Field label="Rejection reason">
          <span className="whitespace-pre-wrap">
            {details.rejectionReason ?? NO_REASON_RECORDED}
          </span>
        </Field>
      ) : null}
    </dl>
  );
}

export function TransactionDetailsView({
  transactionId,
}: {
  transactionId: string;
}) {
  const [details, setDetails] = useState<TransactionDetails | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const requestRef = useRef(0);

  // State is only set from the promise callbacks, never synchronously in an effect.
  const load = useCallback((): Promise<void> => {
    const request = ++requestRef.current;
    return getTransaction(transactionId).then(
      (result) => {
        if (request !== requestRef.current) return;
        setDetails(result);
        setFailure(null);
      },
      (error: unknown) => {
        if (request !== requestRef.current) return;
        if (isRedirectingToSignIn(error)) return;
        setFailure(error ?? new Error('Load failed'));
      },
    );
  }, [transactionId]);

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
    setDetails(null);
    void load();
  };

  let content: ReactNode;
  let heading = 'Transaction details';
  if (failure !== null && statusOf(failure) === 404) {
    heading = TRANSACTION_NOT_FOUND_MESSAGE;
    content = (
      <p className="text-muted-foreground">
        This transaction does not exist or is no longer available.
      </p>
    );
  } else if (failure !== null) {
    content = (
      <Alert variant="destructive">
        <AlertTitle>{LOAD_FAILED_TITLE}</AlertTitle>
        <AlertDescription>
          <p>
            {isNetworkError(failure)
              ? UNREACHABLE_MESSAGE
              : LOAD_FAILED_MESSAGE}
          </p>
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
    );
  } else if (details === null) {
    content = (
      <p role="status" className="text-muted-foreground">
        {LOADING_TRANSACTION_MESSAGE}…
      </p>
    );
  } else {
    heading = `Transaction ${details.reference}`;
    content = <DetailsList details={details} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <BackToTransactions />
      <h1 className="text-2xl font-semibold break-words">{heading}</h1>
      {content}
    </div>
  );
}
