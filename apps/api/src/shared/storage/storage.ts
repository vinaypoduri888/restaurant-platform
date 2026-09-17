/**
 * The storage boundary.
 *
 * Domain code depends on this interface and nothing else. It must never see
 * `node:fs`, an S3 client, a bucket name, or a filesystem path — those are
 * implementation details of whichever adapter is configured, and leaking one
 * into a service is how a codebase becomes impossible to move between
 * providers.
 *
 * Nothing here is R2-specific. A "key" is an opaque path-like string; how an
 * adapter turns it into bytes on a disk or an object in a bucket is its own
 * business.
 */

export interface StoredObject {
  /** The key the object was written under. */
  key: string;
  /** Bytes actually written, for cross-checking against the recorded size. */
  size: number;
}

export interface PutObjectInput {
  key: string;
  body: Uint8Array;
  /** Sent as `Content-Type`; already sniffed from the bytes, not the request. */
  contentType: string;
}

export interface Storage {
  /** Human-readable adapter name, for logs and the readiness payload. */
  readonly driver: "local" | "r2";

  /**
   * Writes an object, replacing anything already at that key.
   *
   * Overwrite rather than fail-if-exists: keys are server-generated and
   * unique per media row, so a collision means a retry of the same upload,
   * where overwriting is the desired outcome.
   */
  put(input: PutObjectInput): Promise<StoredObject>;

  /**
   * Removes an object.
   *
   * Deleting something already gone resolves rather than throwing. A delete is
   * a statement about the desired end state, and treating "already absent" as
   * an error would make cleanup after a partial failure impossible.
   */
  delete(key: string): Promise<void>;

  /** Whether an object exists — used by tests and diagnostics, not by hot paths. */
  exists(key: string): Promise<boolean>;

  /**
   * Reads an object back.
   *
   * Needed because the `local` adapter has no CDN in front of it: the API
   * itself serves those bytes. Returns `null` when the key is absent so callers
   * can answer 404 without catching.
   */
  get(key: string): Promise<Uint8Array | null>;

  /**
   * A stable, publicly fetchable URL for a key.
   *
   * Deliberately returns a URL rather than making callers compose one. Only the
   * adapter knows whether bytes are served by this API or by a CDN domain, and
   * that is precisely the knowledge the abstraction exists to contain.
   */
  publicUrl(key: string): string;
}

/**
 * Builds the object key for a piece of media.
 *
 * Server-generated from ids that are already unique, and **never** from the
 * client's filename — a filename is untrusted input and has no business
 * reaching a path. The restaurant id prefix means one glance at a key says
 * which tenant owns it, and the database enforces that prefix with a CHECK
 * constraint so a row can never point outside its own tenant's namespace.
 *
 * The extension is derived from the sniffed image format, so it always
 * describes the actual bytes.
 */
export function buildMediaKey(restaurantId: string, mediaId: string, extension: string): string {
  return `restaurants/${restaurantId}/media/${mediaId}/original.${extension}`;
}

/**
 * Rejects any key that is not one this application generates.
 *
 * Defence in depth for the adapters: `local` turns a key into a filesystem
 * path, so a key containing `..` or an absolute prefix would be a traversal.
 * Rather than sanitise — which invites an escaping bug — this accepts only the
 * exact shape `buildMediaKey` produces and refuses everything else.
 */
/*
 * The extension is an explicit allow-list, not a generic `[a-z0-9]{2,5}`.
 *
 * A generic class accepted `original.php`, found by test rather than by
 * reasoning. Nothing downstream executes uploaded files, so it was not
 * exploitable here — but a key is a filename, and a filename ending in an
 * interpreter's extension is exactly the input that becomes remote code
 * execution the moment such a directory is ever served by something other than
 * this API. Only the three extensions the sniffer produces are accepted.
 */
const MEDIA_KEY_PATTERN =
  /^restaurants\/[a-z0-9]+\/media\/[a-z0-9]+\/original\.(png|jpg|webp)$/;

export function isSafeMediaKey(key: string): boolean {
  // Checked before the pattern so a rejection reason is never ambiguous, and
  // so an encoded traversal cannot slip through a permissive character class.
  if (key.includes("..") || key.includes("\\") || key.startsWith("/") || key.includes("\0")) {
    return false;
  }
  return MEDIA_KEY_PATTERN.test(key);
}
