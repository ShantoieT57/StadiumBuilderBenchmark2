/** How long the temporary download URL lives before it is revoked. */
const REVOKE_DELAY_MS = 1000;

/**
 * Saves `blob` as `fileName` through a temporary object URL and a hidden
 * `<a download>`. The Blob is passed through unchanged; its contents are never
 * read, shown or logged.
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
