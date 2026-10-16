/**
 * Reads the file name a server gave a download in its `Content-Disposition`
 * header. `filename*` (RFC 5987/6266, e.g. `UTF-8''transactions_2026-04-15.csv`,
 * percent-decoded) wins over `filename` (quoted or bare). The name is used as
 * sent; the browser never builds one of its own.
 */

/** Splits the header into `name=value` parameters, respecting quoted strings. */
function parametersOf(header: string): Map<string, string> {
  const parameters = new Map<string, string>();
  let index = 0;
  const length = header.length;

  const skipSpaces = () => {
    while (index < length && /\s/.test(header[index])) index += 1;
  };

  while (index < length) {
    // Parameter name, up to '=' or ';'.
    skipSpaces();
    let name = '';
    while (index < length && header[index] !== '=' && header[index] !== ';') {
      name += header[index];
      index += 1;
    }
    if (index >= length || header[index] === ';') {
      // A bare token (e.g. the disposition type `attachment`): no value.
      index += 1;
      continue;
    }
    index += 1; // '='
    skipSpaces();

    let value = '';
    if (header[index] === '"') {
      index += 1;
      while (index < length && header[index] !== '"') {
        if (header[index] === '\\' && index + 1 < length) index += 1;
        value += header[index];
        index += 1;
      }
      index += 1; // closing quote
      while (index < length && header[index] !== ';') index += 1;
    } else {
      while (index < length && header[index] !== ';') {
        value += header[index];
        index += 1;
      }
      value = value.trim();
    }
    index += 1; // ';'

    const key = name.trim().toLowerCase();
    if (key !== '' && !parameters.has(key)) parameters.set(key, value);
  }
  return parameters;
}

/** Decodes an RFC 5987 extended value (`charset'lang'percent-encoded`). */
function decodeExtendedValue(value: string): string | null {
  const match = /^([^']*)'[^']*'(.*)$/.exec(value);
  if (match === null) return null;
  const charset = match[1].trim().toLowerCase();
  if (charset !== 'utf-8' && charset !== '') return null;
  try {
    return decodeURIComponent(match[2]);
  } catch {
    return null;
  }
}

/**
 * The file name in a `Content-Disposition` header, or null when the header is
 * missing or carries no readable name.
 */
export function fileNameFromContentDisposition(
  header: string | null | undefined,
): string | null {
  if (header === null || header === undefined || header.trim() === '') {
    return null;
  }
  const parameters = parametersOf(header);

  const extended = parameters.get('filename*');
  if (extended !== undefined) {
    const decoded = decodeExtendedValue(extended);
    if (decoded !== null && decoded.trim() !== '') return decoded;
  }

  const plain = parameters.get('filename');
  if (plain !== undefined && plain.trim() !== '') return plain;

  return null;
}
