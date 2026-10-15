'use client';

/**
 * The transactions filters (R6-R9, BR2, BR3, BR9, BR10, NFR-3).
 *
 * - Every filter lives in the URL next to sort and page. Applying a filter
 *   pushes a new URL that returns to page 1 and keeps the sort.
 * - Status and File apply as soon as an option is chosen. The date and amount
 *   ranges apply when the form is submitted (Apply or Enter). Search applies on
 *   Enter or after a short pause in typing, never on every keystroke.
 * - Range checks run on leaving a field and on submit. While a range is invalid
 *   it is never applied.
 * - md and up: the form sits inline. Below md: a "Filters" button opens the
 *   same form in a Sheet. Active filters show as removable chips in both.
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useForm } from 'react-hook-form';

import {
  fileNameFor,
  useFileOptions,
} from '@/components/transactions/useFileOptions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatTransactionStatus } from '@/lib/format/transaction';
import {
  activeFilters,
  withoutFilter,
  type ActiveFilter,
} from '@/lib/transactions/activeFilters';
import {
  parseListState,
  toListSearch,
  withFilters,
  type TransactionListFilters,
} from '@/lib/transactions/listQuery';
import { cn } from '@/lib/utils';
import {
  transactionFiltersSchema,
  type TransactionFilterValues,
} from '@/lib/validation/transactionFilters';
import type { FileListItem, TransactionStatus } from '@/types/api-generated';

/** How long typing must pause before the search is applied. */
export const SEARCH_PAUSE_MS = 500;

const FILTERS_TITLE = 'Filters';
const ALL = 'all';
const STATUS_OPTIONS: readonly TransactionStatus[] = [
  'Imported',
  'Approved',
  'Rejected',
];

type TextFilterKey = keyof TransactionFilterValues;
const TEXT_KEYS: readonly TextFilterKey[] = [
  'dateFrom',
  'dateTo',
  'minAmount',
  'maxAmount',
  'search',
];

/** The typed fields' values for the filters in the URL. */
function toFormValues(
  filters: TransactionListFilters,
): TransactionFilterValues {
  return {
    dateFrom: filters.dateFrom ?? '',
    dateTo: filters.dateTo ?? '',
    minAmount: filters.minAmount === undefined ? '' : String(filters.minAmount),
    maxAmount: filters.maxAmount === undefined ? '' : String(filters.maxAmount),
    search: filters.search ?? '',
  };
}

/** The typed fields as filters (empty fields are not filters). */
function toTextFilters(
  values: TransactionFilterValues,
): Omit<TransactionListFilters, 'status' | 'fileId'> {
  const text = (value: string) => value.trim() || undefined;
  const amount = (value: string) =>
    value.trim() === '' ? undefined : Number(value.trim());
  return {
    dateFrom: text(values.dateFrom),
    dateTo: text(values.dateTo),
    minAmount: amount(values.minAmount),
    maxAmount: amount(values.maxAmount),
    search: text(values.search),
  };
}

/** Whether a typed value already says the same as the URL value. */
function sameValue(
  key: TextFilterKey,
  typed: string,
  fromUrl: string,
): boolean {
  if (key === 'minAmount' || key === 'maxAmount') {
    if (typed.trim() === '' || fromUrl === '') return typed.trim() === fromUrl;
    return Number(typed) === Number(fromUrl);
  }
  return typed.trim() === fromUrl;
}

interface FilterFormProps {
  filters: TransactionListFilters;
  files: FileListItem[] | null;
  filesFailed: boolean;
  className?: string;
  onSelectFilter: (filters: TransactionListFilters) => void;
  onApply: (filters: TransactionListFilters) => void;
}

function FilterForm({
  filters,
  files,
  filesFailed,
  className,
  onSelectFilter,
  onApply,
}: FilterFormProps) {
  const id = useId();
  const ids = {
    status: `${id}-status`,
    file: `${id}-file`,
    dateFrom: `${id}-date-from`,
    dateTo: `${id}-date-to`,
    minAmount: `${id}-min-amount`,
    maxAmount: `${id}-max-amount`,
    search: `${id}-search`,
  };

  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    clearErrors,
    formState: { errors },
  } = useForm<TransactionFilterValues>({
    resolver: zodResolver(transactionFiltersSchema),
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    defaultValues: toFormValues(filters),
  });

  // Keep the typed fields in step with the URL (a chip removed, Clear all,
  // Back), without discarding what the person typed into other fields.
  const urlValues = useRef(toFormValues(filters));
  useEffect(() => {
    const next = toFormValues(filters);
    const previous = urlValues.current;
    urlValues.current = next;
    for (const key of TEXT_KEYS) {
      if (
        next[key] !== previous[key] &&
        !sameValue(key, getValues(key), next[key])
      ) {
        setValue(key, next[key]);
        clearErrors(key);
      }
    }
  }, [filters, getValues, setValue, clearErrors]);

  // Search after a pause: the latest filters and callback, read when the timer fires.
  const latest = useRef({ filters, onSelectFilter });
  useEffect(() => {
    latest.current = { filters, onSelectFilter };
  }, [filters, onSelectFilter]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const cancelSearch = useCallback(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = undefined;
  }, []);
  useEffect(() => cancelSearch, [cancelSearch]);

  const scheduleSearch = () => {
    cancelSearch();
    searchTimer.current = setTimeout(() => {
      searchTimer.current = undefined;
      const search = getValues('search').trim() || undefined;
      const current = latest.current;
      if (search === current.filters.search) return;
      current.onSelectFilter({ ...current.filters, search });
    }, SEARCH_PAUSE_MS);
  };
  const { onChange: onSearchChange, ...searchField } = register('search');

  const onSubmit = (values: TransactionFilterValues) => {
    onApply({
      status: filters.status,
      fileId: filters.fileId,
      ...toTextFilters(values),
    });
  };

  const fileListed =
    filters.fileId === undefined ||
    (files ?? []).some((file) => file.id === filters.fileId);

  const errorProps = (key: TextFilterKey, errorId: string) =>
    errors[key]
      ? { 'aria-invalid': true as const, 'aria-describedby': errorId }
      : {};

  const fieldError = (key: TextFilterKey, errorId: string) =>
    errors[key] ? (
      <p id={errorId} role="alert" className="text-destructive text-sm">
        {errors[key]?.message}
      </p>
    ) : null;

  return (
    <form
      noValidate
      role="search"
      aria-label="Filter transactions"
      onSubmit={(event) => {
        // Enter / Apply applies the search now: no pending pause-search.
        cancelSearch();
        void handleSubmit(onSubmit)(event);
      }}
      className={cn('grid min-w-0 grid-cols-1 gap-4', className)}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={ids.search}>Search</Label>
        <Input
          id={ids.search}
          type="search"
          placeholder="Reference or account"
          autoComplete="off"
          {...searchField}
          onChange={(event) => {
            void onSearchChange(event);
            scheduleSearch();
          }}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={ids.status}>Status</Label>
        <Select
          value={filters.status ?? ALL}
          onValueChange={(value) =>
            onSelectFilter({
              ...filters,
              status: STATUS_OPTIONS.find((status) => status === value),
            })
          }
        >
          <SelectTrigger id={ids.status} className="w-full min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {STATUS_OPTIONS.map((status) => (
              <SelectItem key={status} value={status}>
                {formatTransactionStatus(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={ids.file}>File</Label>
        <Select
          value={filters.fileId ?? ALL}
          onValueChange={(value) =>
            onSelectFilter({
              ...filters,
              fileId: value === ALL ? undefined : value,
            })
          }
        >
          <SelectTrigger id={ids.file} className="w-full min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All files</SelectItem>
            {!fileListed && filters.fileId && (
              <SelectItem value={filters.fileId}>
                {fileNameFor(files, filters.fileId)}
              </SelectItem>
            )}
            {(files ?? []).map((file) => (
              <SelectItem key={file.id} value={file.id}>
                {file.fileName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filesFailed && (
          <p className="text-muted-foreground text-sm">
            The file list could not be loaded.
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={ids.dateFrom}>From date</Label>
        <Input
          id={ids.dateFrom}
          type="date"
          {...errorProps('dateFrom', `${ids.dateFrom}-error`)}
          {...register('dateFrom')}
        />
        {fieldError('dateFrom', `${ids.dateFrom}-error`)}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={ids.dateTo}>To date</Label>
        <Input
          id={ids.dateTo}
          type="date"
          {...errorProps('dateTo', `${ids.dateTo}-error`)}
          {...register('dateTo')}
        />
        {fieldError('dateTo', `${ids.dateTo}-error`)}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={ids.minAmount}>Minimum amount</Label>
        <Input
          id={ids.minAmount}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          {...errorProps('minAmount', `${ids.minAmount}-error`)}
          {...register('minAmount')}
        />
        {fieldError('minAmount', `${ids.minAmount}-error`)}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={ids.maxAmount}>Maximum amount</Label>
        <Input
          id={ids.maxAmount}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          {...errorProps('maxAmount', `${ids.maxAmount}-error`)}
          {...register('maxAmount')}
        />
        {fieldError('maxAmount', `${ids.maxAmount}-error`)}
      </div>

      <div className="flex items-end">
        <Button type="submit" className="w-full">
          Apply filters
        </Button>
      </div>
    </form>
  );
}

function ActiveFilterChips({
  entries,
  onRemove,
  onClearAll,
}: {
  entries: ActiveFilter[];
  onRemove: (entry: ActiveFilter) => void;
  onClearAll: () => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {/* Label-only tooltips: they close as soon as the pointer leaves the button. */}
      <TooltipProvider disableHoverableContent>
        <ul
          aria-label="Active filters"
          className="flex min-w-0 flex-wrap items-center gap-2"
        >
          {entries.map((entry) => {
            const removeLabel = `Remove ${entry.label} filter`;
            return (
              <li
                key={entry.key}
                className="bg-secondary text-secondary-foreground inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-3 text-sm"
              >
                <span className="min-w-0 break-all">
                  <span className="font-medium">{entry.label}:</span>{' '}
                  {entry.value}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0 rounded-full"
                      aria-label={removeLabel}
                      onClick={() => onRemove(entry)}
                    >
                      <XIcon aria-hidden="true" className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{removeLabel}</TooltipContent>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </TooltipProvider>
      <Button type="button" variant="ghost" size="sm" onClick={onClearAll}>
        Clear all
      </Button>
    </div>
  );
}

export function TransactionFilters() {
  const router = useRouter();
  const pathname = usePathname() ?? '/transactions';
  const searchParams = useSearchParams();
  const urlSearch = searchParams?.toString() ?? '';
  const view = useMemo(
    () => parseListState(new URLSearchParams(urlSearch)),
    [urlSearch],
  );
  const { files, failed } = useFileOptions();
  const [sheetOpen, setSheetOpen] = useState(false);
  const headingId = useId();

  const navigate = useCallback(
    (filters: TransactionListFilters) => {
      const search = toListSearch(withFilters(view, filters));
      router.push(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname, view],
  );

  const entries = activeFilters(view.filters, (fileId) =>
    fileNameFor(files, fileId),
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="md:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button type="button" variant="outline">
              <SlidersHorizontalIcon aria-hidden="true" />
              {FILTERS_TITLE}
            </Button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="w-full overflow-y-auto sm:max-w-sm"
          >
            <SheetHeader>
              <SheetTitle>{FILTERS_TITLE}</SheetTitle>
              <SheetDescription className="sr-only">
                Narrow the transactions list.
              </SheetDescription>
            </SheetHeader>
            <FilterForm
              filters={view.filters}
              files={files}
              filesFailed={failed}
              className="px-4 pb-4"
              onSelectFilter={navigate}
              onApply={(filters) => {
                navigate(filters);
                setSheetOpen(false);
              }}
            />
          </SheetContent>
        </Sheet>
      </div>

      <section
        aria-labelledby={headingId}
        className="hidden min-w-0 flex-col gap-3 md:flex"
      >
        <h2 id={headingId} className="text-lg font-semibold">
          {FILTERS_TITLE}
        </h2>
        <FilterForm
          filters={view.filters}
          files={files}
          filesFailed={failed}
          className="md:grid-cols-2 lg:grid-cols-1"
          onSelectFilter={navigate}
          onApply={navigate}
        />
      </section>

      <ActiveFilterChips
        entries={entries}
        onRemove={(entry) => navigate(withoutFilter(view.filters, entry.key))}
        onClearAll={() => navigate({})}
      />
    </div>
  );
}
