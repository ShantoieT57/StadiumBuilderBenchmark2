'use client';

/**
 * The Dashboard file filters (R5, R6, BR4, NFR-3, NFR-4).
 *
 * - Every filter lives in the URL next to sort and page. Applying a filter
 *   pushes a new URL that returns to page 1 and keeps the sort.
 * - Status and Show apply as soon as an option is chosen. The process-date
 *   range applies when the form is submitted (Apply or Enter). File name
 *   applies on Enter or after a short pause in typing, never on every keystroke.
 * - Date checks run on leaving a field and on submit. While the range is
 *   invalid it is never applied.
 * - md and up: the form sits inline. Below md: a "Filters" button opens the
 *   same form in a full-width bottom Sheet. Active filters show as removable
 *   chips in both.
 */

import { SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';

import { useFileListQuery } from '@/components/files/useFileListQuery';
import { Badge } from '@/components/ui/badge';
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
import {
  activeFileFilters,
  withoutFileFilter,
  type ActiveFileFilter,
} from '@/lib/files/activeFilters';
import {
  FILE_STATUSES,
  withFileFilters,
  type FileListFilters,
} from '@/lib/files/listQuery';
import { formatFileStatus } from '@/lib/format/file';
import { cn } from '@/lib/utils';
import {
  fileFiltersSchema,
  type FileFilterValues,
} from '@/lib/validation/fileFilters';

/** How long typing must pause before the file name is applied. */
export const FILE_NAME_PAUSE_MS = 500;

const FILTERS_TITLE = 'Filters';
const ANY = 'any';
const ACTIVE = 'Active';

const SHOW_OPTIONS = [
  { value: ACTIVE, label: 'Active files' },
  { value: 'Cancelled', label: 'Cancelled files' },
  { value: 'Both', label: 'Both' },
] as const;

type TextFilterKey = keyof FileFilterValues;
const TEXT_KEYS: readonly TextFilterKey[] = [
  'fileName',
  'processedFrom',
  'processedTo',
];

/** The typed fields' values for the filters in the URL. */
function toFormValues(filters: FileListFilters): FileFilterValues {
  return {
    fileName: filters.fileName ?? '',
    processedFrom: filters.processedFrom ?? '',
    processedTo: filters.processedTo ?? '',
  };
}

/** The typed fields as filters (empty fields are not filters). */
function toTextFilters(
  values: FileFilterValues,
): Pick<FileListFilters, 'fileName' | 'processedFrom' | 'processedTo'> {
  const text = (value: string) => value.trim() || undefined;
  return {
    fileName: text(values.fileName),
    processedFrom: text(values.processedFrom),
    processedTo: text(values.processedTo),
  };
}

interface FilterFormProps {
  filters: FileListFilters;
  className?: string;
  onSelectFilter: (filters: FileListFilters) => void;
  onApply: (filters: FileListFilters) => void;
}

function FilterForm({
  filters,
  className,
  onSelectFilter,
  onApply,
}: FilterFormProps) {
  const id = useId();
  const ids = {
    status: `${id}-status`,
    show: `${id}-show`,
    fileName: `${id}-file-name`,
    processedFrom: `${id}-processed-from`,
    processedTo: `${id}-processed-to`,
  };

  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    clearErrors,
    formState: { errors },
  } = useForm<FileFilterValues>({
    resolver: zodResolver(fileFiltersSchema),
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
      if (next[key] !== previous[key] && getValues(key).trim() !== next[key]) {
        setValue(key, next[key]);
        clearErrors(key);
      }
    }
  }, [filters, getValues, setValue, clearErrors]);

  // File name after a pause: the latest filters and callback, read when the timer fires.
  const latest = useRef({ filters, onSelectFilter });
  useEffect(() => {
    latest.current = { filters, onSelectFilter };
  }, [filters, onSelectFilter]);
  const nameTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const cancelNamePause = useCallback(() => {
    clearTimeout(nameTimer.current);
    nameTimer.current = undefined;
  }, []);
  useEffect(() => cancelNamePause, [cancelNamePause]);

  const scheduleName = () => {
    cancelNamePause();
    nameTimer.current = setTimeout(() => {
      nameTimer.current = undefined;
      const fileName = getValues('fileName').trim() || undefined;
      const current = latest.current;
      if (fileName === current.filters.fileName) return;
      current.onSelectFilter({ ...current.filters, fileName });
    }, FILE_NAME_PAUSE_MS);
  };
  const { onChange: onNameChange, ...nameField } = register('fileName');

  // Choosing a Status or Show while a file-name pause is pending applies that
  // name too, so the timer cannot later push a URL built from stale filters.
  const selectFilter = (next: FileListFilters) => {
    if (nameTimer.current === undefined) {
      onSelectFilter(next);
      return;
    }
    cancelNamePause();
    onSelectFilter({
      ...next,
      fileName: getValues('fileName').trim() || undefined,
    });
  };

  const onSubmit = (values: FileFilterValues) => {
    onApply({
      status: filters.status,
      visibility: filters.visibility,
      ...toTextFilters(values),
    });
  };

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
      aria-label="Filter files"
      onSubmit={(event) => {
        // Enter / Apply applies the file name now: no pending pause.
        cancelNamePause();
        void handleSubmit(onSubmit)(event);
      }}
      className={cn('grid min-w-0 grid-cols-1 gap-4', className)}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={ids.fileName}>File name</Label>
        <Input
          id={ids.fileName}
          type="text"
          placeholder="Part of a file name"
          autoComplete="off"
          {...nameField}
          onChange={(event) => {
            void onNameChange(event);
            scheduleName();
          }}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={ids.status}>Status</Label>
        <Select
          value={filters.status ?? ANY}
          onValueChange={(value) =>
            selectFilter({
              ...filters,
              status: FILE_STATUSES.find((status) => status === value),
            })
          }
        >
          <SelectTrigger id={ids.status} className="w-full min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any</SelectItem>
            {FILE_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {formatFileStatus(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={ids.show}>Show</Label>
        <Select
          value={filters.visibility ?? ACTIVE}
          onValueChange={(value) =>
            selectFilter({
              ...filters,
              visibility:
                value === 'Cancelled' || value === 'Both' ? value : undefined,
            })
          }
        >
          <SelectTrigger id={ids.show} className="w-full min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHOW_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={ids.processedFrom}>Processed from</Label>
        <Input
          id={ids.processedFrom}
          type="date"
          className="min-w-0"
          {...errorProps('processedFrom', `${ids.processedFrom}-error`)}
          {...register('processedFrom')}
        />
        {fieldError('processedFrom', `${ids.processedFrom}-error`)}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={ids.processedTo}>Processed to</Label>
        <Input
          id={ids.processedTo}
          type="date"
          className="min-w-0"
          {...errorProps('processedTo', `${ids.processedTo}-error`)}
          {...register('processedTo')}
        />
        {fieldError('processedTo', `${ids.processedTo}-error`)}
      </div>

      <div className="flex items-end">
        <Button type="submit" className="w-full">
          Apply
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
  entries: ActiveFileFilter[];
  onRemove: (entry: ActiveFileFilter) => void;
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
              <Badge
                asChild
                key={entry.key}
                variant="secondary"
                className="border-border max-w-full min-w-0 justify-start gap-1 overflow-visible py-0.5 pr-0.5 pl-3 text-sm font-normal whitespace-normal"
              >
                <li>
                  {entry.key === 'visibility' ? (
                    <span className="min-w-0 break-all">{entry.value}</span>
                  ) : (
                    <span className="min-w-0 break-all">
                      <span className="font-medium">{entry.label}:</span>{' '}
                      {entry.value}
                    </span>
                  )}
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
              </Badge>
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

export function FileFilters() {
  const { view, navigate: navigateTo } = useFileListQuery();
  const [sheetOpen, setSheetOpen] = useState(false);
  const headingId = useId();

  const navigate = useCallback(
    (filters: FileListFilters) => navigateTo(withFileFilters(view, filters)),
    [navigateTo, view],
  );

  const entries = activeFileFilters(view.filters);

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
          {/* A bottom sheet: it slides up, so it never sits (even mid-animation)
              past the side of a phone screen, and spans the full width. */}
          <SheetContent
            side="bottom"
            className="max-h-[85dvh] w-full max-w-full min-w-0 overflow-x-hidden overflow-y-auto"
          >
            <SheetHeader>
              <SheetTitle>{FILTERS_TITLE}</SheetTitle>
              <SheetDescription className="sr-only">
                Narrow the file list.
              </SheetDescription>
            </SheetHeader>
            <FilterForm
              filters={view.filters}
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
          className="md:grid-cols-2 lg:grid-cols-1"
          onSelectFilter={navigate}
          onApply={navigate}
        />
      </section>

      <ActiveFilterChips
        entries={entries}
        onRemove={(entry) =>
          navigate(withoutFileFilter(view.filters, entry.key))
        }
        onClearAll={() => navigate({})}
      />
    </div>
  );
}
