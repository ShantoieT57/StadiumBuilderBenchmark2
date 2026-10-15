/**
 * POST /files (UploadFile) - the one upload transport.
 *
 * The shared fetch-based API client cannot report upload progress, so this
 * uses XMLHttpRequest (NFR-1). It still goes to the same-origin `/api` proxy
 * (never the back-end address) and fails with the same `APIError` shape as the
 * client - built by the client's own helpers - so screens keep branching with
 * `@/lib/api/errors` (`isNetworkError`, `isRedirectingToSignIn`, `statusOf`):
 * - no answer, an abort, or a 502-504 from the proxy -> statusCode 0 / isNetworkError;
 * - 401 -> the central sign-in redirect with the reason (`redirecting: true`);
 * - any other refusal keeps `message`, `errors` (ValidationProblem) and `body`.
 *
 * Privacy (NFR-4): the file's contents are never read or logged here; the
 * browser streams the File straight into the multipart body.
 */
import { apiErrorFromResponse, createNetworkError } from '@/lib/api/client';
import { API_BASE_URL } from '@/lib/utils/constants';
import type { FileKind, UploadedFile } from '@/types/api-generated';

export interface UploadFileOptions {
  /** Called with the whole-number percentage of the file sent so far (0-100). */
  onProgress?: (percent: number) => void;
  /** Aborting it cancels the upload, which then fails as a network error. */
  signal?: AbortSignal;
}

/**
 * What a finished upload is known to be. Any 2xx means the file was stored:
 * normally the 201 body (`UploadedFile`), but when that answer has no readable
 * body only the file's name is known and there is no `id` to link to.
 */
export type UploadResult = UploadedFile | { fileName: string; id?: undefined };

const UPLOAD_URL = `${API_BASE_URL}/files`;

/** Whole-number percentage of `loaded` out of `total`, kept within 0-100. */
function percentOf(loaded: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
}

/** The response body as text, whichever `responseType` the request used. */
function responseTextOf(xhr: XMLHttpRequest): string {
  if (xhr.responseType === 'json') {
    return xhr.response == null ? '' : JSON.stringify(xhr.response);
  }
  return typeof xhr.responseText === 'string' ? xhr.responseText : '';
}

/**
 * A 2xx answer as the upload's result: the `UploadedFile` body when it is one,
 * else just the sent file's name (an empty or non-JSON body still means stored).
 */
function resultFor(xhr: XMLHttpRequest, file: File): UploadResult {
  try {
    const body: unknown = JSON.parse(responseTextOf(xhr));
    if (typeof body === 'object' && body !== null) {
      const { id, fileName } = body as { id?: unknown; fileName?: unknown };
      if (typeof id === 'string' && typeof fileName === 'string') {
        return body as UploadedFile;
      }
    }
  } catch {
    // Not JSON: fall through to what is known.
  }
  return { fileName: file.name };
}

/** A finished request's error answer as the API client's `APIError`. */
async function errorFor(xhr: XMLHttpRequest): Promise<unknown> {
  const text = responseTextOf(xhr);
  const contentType = xhr.getResponseHeader('content-type');
  try {
    const response = new Response(text === '' ? null : text, {
      status: xhr.status,
      statusText: xhr.statusText,
      headers: contentType ? { 'content-type': contentType } : undefined,
    });
    return await apiErrorFromResponse(response, UPLOAD_URL);
  } catch {
    // A status the Fetch API cannot represent: treat it as no usable answer.
    return createNetworkError(UPLOAD_URL);
  }
}

/**
 * POST /files - uploads one file as multipart/form-data (`file`, `kind`) and
 * resolves with the received file (any 2xx; see `UploadResult`). Rejects with
 * an `APIError`.
 */
export function uploadFile(
  file: File,
  kind: FileKind,
  { onProgress, signal }: UploadFileOptions = {},
): Promise<UploadResult> {
  return new Promise<UploadResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createNetworkError(UPLOAD_URL));
      return;
    }

    const xhr = new XMLHttpRequest();
    const onAbortSignal = () => xhr.abort();
    const cleanUp = () => signal?.removeEventListener('abort', onAbortSignal);
    const failAsNetworkError = () => {
      cleanUp();
      reject(createNetworkError(UPLOAD_URL));
    };

    xhr.open('POST', UPLOAD_URL);

    if (onProgress) {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          onProgress(percentOf(event.loaded, event.total));
        }
      });
    }

    xhr.addEventListener('load', () => {
      cleanUp();
      if (xhr.status >= 200 && xhr.status < 300) {
        // Any 2xx means stored: never offer "Try again", which would duplicate it.
        resolve(resultFor(xhr, file));
        return;
      }
      if (xhr.status === 0) {
        reject(createNetworkError(UPLOAD_URL));
        return;
      }
      void errorFor(xhr).then(reject);
    });
    xhr.addEventListener('error', failAsNetworkError);
    xhr.addEventListener('abort', failAsNetworkError);
    xhr.addEventListener('timeout', failAsNetworkError);
    signal?.addEventListener('abort', onAbortSignal);

    const body = new FormData();
    body.append('file', file, file.name);
    body.append('kind', kind);
    xhr.send(body);
  });
}
