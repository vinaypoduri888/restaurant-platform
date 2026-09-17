import { config } from "../../config.ts";
import { LocalFilesystemStorage } from "./local-storage.ts";
import { R2Storage } from "./r2-storage.ts";
import type { Storage } from "./storage.ts";

export type { PutObjectInput, Storage, StoredObject } from "./storage.ts";
export { buildMediaKey, isSafeMediaKey } from "./storage.ts";
export { LocalFilesystemStorage } from "./local-storage.ts";
export { R2Storage } from "./r2-storage.ts";

/**
 * Builds the adapter the configuration asks for.
 *
 * The one place in the application that knows more than one adapter exists.
 * Everything downstream receives a `Storage` and cannot tell which it got —
 * which is what makes moving between local disk and R2 a configuration change
 * rather than a code change.
 */
export function createStorage(): Storage {
  if (config.storage.driver === "r2") {
    // Non-null because `config` already refused to start the process with
    // `STORAGE_DRIVER=r2` and any credential missing.
    return new R2Storage(config.storage.r2!);
  }

  return new LocalFilesystemStorage(config.storage.local);
}

/**
 * The application's storage, created once.
 *
 * A module-level singleton rather than a per-request construction: adapters are
 * stateless handles, and rebuilding an S3 client per upload would throw away
 * connection reuse for nothing.
 */
export const storage: Storage = createStorage();
