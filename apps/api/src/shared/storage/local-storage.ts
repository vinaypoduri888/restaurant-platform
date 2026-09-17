import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isSafeMediaKey, type PutObjectInput, type Storage, type StoredObject } from "./storage.ts";

/**
 * Stores objects on the local filesystem.
 *
 * For development only. `ARCHITECTURE.md` §10 is explicit that production must
 * not write uploads to the API's own disk — it breaks horizontal scaling and
 * the files vanish when a container restarts. This adapter exists so the whole
 * media feature is usable with no cloud credentials, and so the `r2` adapter is
 * a configuration change rather than a rewrite.
 *
 * ─── Path safety ────────────────────────────────────────────────────────────
 *
 * Two independent barriers, because a traversal here is arbitrary file write:
 *
 *   1. Keys must match the exact shape this application generates
 *      (`isSafeMediaKey`). Nothing is sanitised — anything unexpected is
 *      refused outright, which cannot be defeated by clever escaping.
 *   2. The resolved absolute path is then checked to still be inside the root.
 *      That catches anything the pattern somehow admitted, plus symlink and
 *      platform-specific surprises.
 *
 * Either alone would probably do. Both together mean a mistake in one is not a
 * vulnerability.
 */
export class LocalFilesystemStorage implements Storage {
  readonly driver = "local" as const;

  private readonly root: string;
  private readonly baseUrl: string;

  constructor(options: { rootPath: string; publicBaseUrl: string }) {
    // Resolved once, at construction, so every later comparison is against an
    // absolute canonical path rather than whatever the process's cwd is now.
    this.root = resolve(options.rootPath);
    this.baseUrl = options.publicBaseUrl.replace(/\/+$/, "");
  }

  async put({ key, body, contentType }: PutObjectInput): Promise<StoredObject> {
    void contentType; // Not persisted: the filesystem has no object metadata.
    const path = this.resolveKey(key);

    // Created on demand rather than at startup: the tree is one directory per
    // media id, so it cannot be known in advance.
    await mkdir(dirname(path), { recursive: true });

    // `writeFile` with a Uint8Array writes the exact bytes — no encoding is
    // applied, which is what keeps binary image data intact.
    await writeFile(path, body);

    return { key, size: body.byteLength };
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const buffer = await readFile(this.resolveKey(key));
      return new Uint8Array(buffer);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    // `force` makes an already-absent object a success. A delete states the
    // desired end state, and failing on "already gone" would make cleanup
    // after a partial failure impossible.
    await rm(this.resolveKey(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  /**
   * Bytes are served by this API, not by a CDN, so the URL points at the
   * media route. Callers get a stable relative-to-host URL and never learn
   * that a filesystem is involved.
   */
  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }

  /**
   * Turns a key into an absolute path, refusing anything that would escape.
   *
   * Throws rather than returning null: reaching here with an unsafe key means
   * a bug upstream, and silently substituting a safe path would hide it.
   */
  private resolveKey(key: string): string {
    if (!isSafeMediaKey(key)) {
      throw new Error("Refusing to resolve an unrecognised storage key");
    }

    const path = resolve(join(this.root, key));
    const rel = relative(this.root, path);

    // `relative` returns something starting with ".." when the target sits
    // outside the root, and an absolute path when they are on different drives
    // — a real case on Windows.
    if (rel.startsWith("..") || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error("Refusing to resolve a storage key outside the storage root");
    }

    return path;
  }
}

function isNotFound(error: unknown): boolean {
  return (error as { code?: string }).code === "ENOENT";
}
