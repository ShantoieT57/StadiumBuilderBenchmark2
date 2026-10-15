/**
 * Client pre-checks for a chosen or dropped upload (BR2). The wording is
 * identical to the back-end's POST /files refusals, so the Importer sees the
 * same message whichever side refuses. There is no size check: the maximum is
 * configured on the server and its 413 message names it.
 */

/** More than one file in a single choice or drop. */
export const ONE_FILE_AT_A_TIME_MESSAGE = 'Upload one file at a time.';

/** The file name does not end in `.csv` (any case). */
export const NOT_CSV_MESSAGE =
  'Only .csv files can be uploaded. Please choose a .csv file.';

/** Empty name, over 255 characters, or containing `..`, `\`, `/` or `:`. */
export const INVALID_FILE_NAME_MESSAGE = 'Invalid file name';

/** Longest file name the back-end accepts. */
export const MAX_FILE_NAME_LENGTH = 255;

const FORBIDDEN_NAME_PARTS = ['..', '\\', '/', ':'] as const;

/** Why a single file name is refused, or null when it may be uploaded. */
export function fileNameRefusal(name: string): string | null {
  if (
    name.length === 0 ||
    name.length > MAX_FILE_NAME_LENGTH ||
    FORBIDDEN_NAME_PARTS.some((part) => name.includes(part))
  ) {
    return INVALID_FILE_NAME_MESSAGE;
  }
  if (!name.toLowerCase().endsWith('.csv')) return NOT_CSV_MESSAGE;
  return null;
}

/**
 * Why the chosen / dropped files are refused, or null when the single file may
 * be uploaded. Callers pass the names only; contents are never read (NFR-4).
 */
export function uploadRefusal(fileNames: readonly string[]): string | null {
  if (fileNames.length > 1) return ONE_FILE_AT_A_TIME_MESSAGE;
  const [name] = fileNames;
  if (name === undefined) return null;
  return fileNameRefusal(name);
}
