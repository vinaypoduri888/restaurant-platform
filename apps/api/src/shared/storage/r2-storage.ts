import { isSafeMediaKey, type PutObjectInput, type Storage, type StoredObject } from "./storage.ts";

export interface R2StorageOptions {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** CDN or bucket domain objects are publicly readable from. */
  publicBaseUrl: string;
}

/**
 * Stores objects in Cloudflare R2.
 *
 * ─── Why no SDK dependency ──────────────────────────────────────────────────
 *
 * R2 speaks the S3 API, which needs AWS SigV4 request signing. The obvious
 * answer is `@aws-sdk/client-s3`, but this project runs on Bun, and Bun ships
 * an S3 client in its own runtime (`Bun.S3Client`) that speaks to any
 * S3-compatible endpoint — R2 included. Verified present in the pinned Bun
 * 1.3.14 before choosing this.
 *
 * So R2 support costs **zero new dependencies**, which matters for a project
 * whose stated policy is to add one only when genuinely required. The
 * alternative would have been either a large transitive dependency tree or
 * hand-rolled SigV4 signing — security-critical crypto code that nobody should
 * write when the runtime already has it.
 *
 * The coupling to Bun is acceptable: `apps/api` already runs only on Bun.
 *
 * ─── Not verified against a live bucket ─────────────────────────────────────
 *
 * There are no R2 credentials in this environment, so this adapter is covered
 * structurally and by unit tests only. It has never performed a real upload.
 * That is stated plainly rather than implied — see the phase report.
 */
export class R2Storage implements Storage {
  readonly driver = "r2" as const;

  private readonly bucket: ReturnType<typeof createBucket>;
  private readonly baseUrl: string;

  constructor(options: R2StorageOptions) {
    this.bucket = createBucket(options);
    this.baseUrl = options.publicBaseUrl.replace(/\/+$/, "");
  }

  async put({ key, body, contentType }: PutObjectInput): Promise<StoredObject> {
    // The same key check the local adapter applies. R2 has no filesystem to
    // escape, but an unexpected key shape still means a bug upstream, and both
    // adapters must accept exactly the same set of keys or they are not
    // interchangeable.
    assertSafe(key);

    await this.bucket.file(key).write(body, { type: contentType });
    return { key, size: body.byteLength };
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertSafe(key);

    const file = this.bucket.file(key);
    if (!(await file.exists())) return null;

    return new Uint8Array(await file.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    assertSafe(key);

    // Like the local adapter, an already-absent object is a success.
    await this.bucket.file(key).delete();
  }

  async exists(key: string): Promise<boolean> {
    assertSafe(key);
    return this.bucket.file(key).exists();
  }

  /**
   * Objects are read through the configured public domain, never through a
   * signed URL: branding images are public by nature, and signing every
   * customer's logo request would defeat CDN caching for no benefit.
   */
  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }
}

function assertSafe(key: string): void {
  if (!isSafeMediaKey(key)) {
    throw new Error("Refusing to use an unrecognised storage key");
  }
}

/**
 * Builds Bun's S3 client pointed at an R2 bucket.
 *
 * R2's endpoint is account-scoped and its region is always `auto` — the two
 * details that make an S3 client talk to R2 rather than to AWS.
 */
function createBucket(options: R2StorageOptions) {
  return new Bun.S3Client({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    bucket: options.bucket,
    endpoint: `https://${options.accountId}.r2.cloudflarestorage.com`,
    region: "auto",
  });
}
