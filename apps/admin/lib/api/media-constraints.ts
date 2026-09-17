/**
 * The upload limits, mirrored for display and fast feedback only.
 *
 * ─── Why these are duplicated, and what that costs ──────────────────────────
 *
 * The API owns these rules (`MEDIA_MAX_BYTES`, `MEDIA_MAX_DIMENSION`, and the
 * formats its sniffer recognises) and enforces every one of them on the bytes
 * it receives. It does not currently expose them, and adding an endpoint to do
 * so is a backend change that is out of scope for this phase.
 *
 * So they are restated here for two purposes only: telling a person what is
 * allowed *before* they pick a file, and rejecting an obviously-wrong file
 * without a pointless round trip. **Neither is a security control.** If these
 * values drift from the API's, the API still refuses correctly and the console
 * simply shows a slightly wrong hint — the failure mode is cosmetic, never
 * permissive.
 *
 * Overridable by environment so a deployment that raises the API's limits can
 * keep the hints truthful without a code change.
 */

export const MEDIA_MAX_BYTES = Number(process.env.MEDIA_MAX_BYTES ?? 5_000_000);

export const MEDIA_MAX_DIMENSION = Number(process.env.MEDIA_MAX_DIMENSION ?? 4096);

/**
 * The formats the API's sniffer accepts.
 *
 * SVG is absent deliberately, not by oversight: it is XML that can carry
 * script, and the API refuses it. Listing it here would promise something the
 * backend rejects.
 */
export const ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** For the file input's `accept`, which narrows the system file picker. */
export const ACCEPT_ATTRIBUTE = ACCEPTED_MIME_TYPES.join(",");

export const ACCEPTED_FORMATS_LABEL = "PNG, JPEG or WebP";

/** "5 MB" — for copy, not for arithmetic. */
export function formatMaxSize(): string {
  return `${Math.floor(MEDIA_MAX_BYTES / 1_000_000)} MB`;
}

/**
 * A fast, local pre-check.
 *
 * Returns a message to show immediately, or `null` to let the request proceed.
 * Deliberately checks only what a browser can know for free — size and the
 * declared type. It does **not** try to sniff the bytes: that is the API's job,
 * it does it properly, and duplicating it here would create a second
 * implementation to drift.
 */
export function preCheckFile(file: File): string | null {
  if (file.size === 0) {
    return "That file is empty. Choose an image.";
  }

  if (file.size > MEDIA_MAX_BYTES) {
    return `That image is larger than ${formatMaxSize()}. Choose a smaller file.`;
  }

  /*
   * The browser's reported type is a hint, not proof — it comes from the file
   * extension on most platforms. A mismatch is worth catching early, but a
   * *match* proves nothing, which is why the API re-reads the actual bytes.
   */
  if (file.type && !ACCEPTED_MIME_TYPES.includes(file.type as (typeof ACCEPTED_MIME_TYPES)[number])) {
    return `That looks like ${file.type}. Accepted formats are ${ACCEPTED_FORMATS_LABEL}.`;
  }

  return null;
}
