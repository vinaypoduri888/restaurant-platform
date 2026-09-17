import { db } from "@repo/database";
import type { MediaPurpose } from "@repo/validation/media";
import { config } from "../../config.ts";
import { BadRequestError, NotFoundError } from "../../shared/errors.ts";
import { readImageInfo, SUPPORTED_FORMATS } from "../../shared/image-format.ts";
import { storage } from "../../shared/storage/index.ts";
import { buildMediaKey } from "../../shared/storage/storage.ts";
import { membershipService } from "../auth/membership.service.ts";
import { mediaRepository, type PublicMediaRow } from "./media.repository.ts";

/**
 * Restaurant branding media.
 *
 * ─── The consistency problem, and how it is handled ─────────────────────────
 *
 * PostgreSQL and object storage cannot participate in one transaction. A naive
 * "write the file, then insert the row" leaves an orphaned object whenever the
 * insert fails; "insert the row, then write the file" is worse, because it
 * leaves a row whose URL 404s for every customer.
 *
 * What is done instead: the database work happens **inside a transaction that
 * stays open across the storage call**. If the storage operation throws, the
 * transaction rolls back and the database is untouched — no orphan row, no
 * half-state.
 *
 * The one window that cannot be closed is a *commit* failure after the storage
 * call already succeeded. On upload that leaves an unreferenced object (wasted
 * bytes, invisible to users); on delete it leaves a row pointing at an object
 * that is gone (a broken image). Both are logged. Closing them entirely would
 * need a two-phase commit that neither system offers, and pretending otherwise
 * would be dishonest.
 *
 * The cost of this choice is a transaction held open for the duration of one
 * object write. That is acceptable here: uploading a logo is a rare
 * administrative action, not a hot path.
 */

/** Local ids for storage keys, generated before the row exists. */
function newMediaId(): string {
  /*
   * Generated in application code rather than by the column's `cuid()` default
   * because the storage key embeds the media id — and the database enforces
   * that with a CHECK constraint. The key therefore has to be known at insert
   * time, which rules out letting the database mint the id.
   *
   * 32 lowercase hex characters: unique, opaque, and within the `[a-z0-9]+`
   * shape the key pattern accepts.
   */
  return crypto.randomUUID().replaceAll("-", "");
}

export interface UploadedFile {
  bytes: Uint8Array;
  /** The name the browser sent. Untrusted — recorded, never used as a path. */
  originalName: string;
}

export const mediaService = {
  /** Everything a restaurant has uploaded, for the admin surface. */
  async listForUser(userId: string, restaurantId: string) {
    await membershipService.authorize(userId, restaurantId, "media:read");
    return mediaRepository.findManyByRestaurant(restaurantId);
  },

  /**
   * Stores an image and records it, replacing whatever held that purpose.
   *
   * Replacement rather than accumulation: `@@unique([restaurantId, purpose])`
   * means a restaurant has exactly one logo, so uploading a new one is an
   * intentional swap, not a second row nothing would ever pick between.
   */
  async upload(
    userId: string,
    restaurantId: string,
    purpose: MediaPurpose,
    file: UploadedFile,
  ) {
    await membershipService.authorize(userId, restaurantId, "media:write");

    const image = this.inspect(file.bytes);
    const mediaId = newMediaId();
    const key = buildMediaKey(restaurantId, mediaId, image.extension);

    // Captured before the swap so its object can be cleaned up afterwards.
    const previous = await mediaRepository.findByPurpose(restaurantId, purpose);

    const created = await db.$transaction(async (tx) => {
      if (previous) {
        await tx.restaurantMedia.delete({ where: { id: previous.id } });
      }

      const row = await tx.restaurantMedia.create({
        data: {
          id: mediaId,
          // From the authorized URL scope, never from the request body.
          restaurantId,
          purpose,
          storageKey: key,
          originalName: file.originalName,
          // The sniffed type, not the one the client claimed.
          mimeType: image.mimeType,
          sizeBytes: file.bytes.byteLength,
          width: image.width,
          height: image.height,
        },
      });

      // Inside the transaction on purpose: a storage failure here rolls the
      // row back, so a failed upload leaves nothing behind.
      await storage.put({ key, body: file.bytes, contentType: image.mimeType });

      return row;
    });

    /*
     * The replaced object is removed only after the commit. Doing it earlier
     * would destroy a live image if the transaction then rolled back. A failure
     * here is an orphaned object, not a broken page, so it is logged rather
     * than surfaced.
     */
    if (previous) {
      await storage.delete(previous.storageKey).catch((error: unknown) => {
        console.error("[media] replaced object could not be removed", {
          key: previous.storageKey,
          error,
        });
      });
    }

    return this.toAdminView(created);
  },

  /**
   * Removes a piece of media and its stored object.
   *
   * OWNER only (`media:delete`): the object is destroyed with no reversible
   * "hide" alternative, which places it with the other irreversible actions.
   */
  async remove(userId: string, restaurantId: string, mediaId: string) {
    await membershipService.authorize(userId, restaurantId, "media:delete");

    const existing = await mediaRepository.findScoped(restaurantId, mediaId);
    if (!existing) {
      throw new NotFoundError(`Media "${mediaId}" not found`);
    }

    await db.$transaction(async (tx) => {
      // Scoped by tenant in the statement itself, not by the read above.
      const { count } = await tx.restaurantMedia.deleteMany({
        where: { id: mediaId, restaurantId },
      });

      if (count === 0) {
        throw new NotFoundError(`Media "${mediaId}" not found`);
      }

      // Inside the transaction so that a storage failure rolls the row
      // deletion back — the record is never silently dropped while its object
      // survives.
      await storage.delete(existing.storageKey);
    });
  },

  /**
   * The storage keys a restaurant owns.
   *
   * Read *before* the restaurant is deleted: the database cascade removes the
   * metadata rows, and once they are gone there is no record of which objects
   * belonged to it.
   */
  async listStorageKeys(restaurantId: string): Promise<string[]> {
    const rows = await mediaRepository.findManyByRestaurant(restaurantId);
    return rows.map((row) => row.storageKey);
  },

  /**
   * Best-effort removal of objects whose metadata is already gone.
   *
   * Called after a restaurant delete has committed. Failures are logged, never
   * thrown: the caller's intent — removing the restaurant — has already
   * succeeded, and refusing to acknowledge that because a file could not be
   * unlinked would be the wrong trade. An object left behind is unreachable
   * anyway, since serving requires a database row.
   */
  async purgeObjects(keys: readonly string[]): Promise<void> {
    await Promise.all(
      keys.map((key) =>
        storage.delete(key).catch((error: unknown) => {
          console.error("[media] orphaned object could not be removed", { key, error });
        }),
      ),
    );
  },

  /**
   * Reads an object back, for the `local` adapter's serving route.
   *
   * Looked up by key through the database rather than hitting storage
   * directly: an object only exists for the public to read if a row references
   * it, so this refuses to serve anything orphaned.
   */
  async readPublicObject(key: string) {
    const row = await db.restaurantMedia.findUnique({ where: { storageKey: key } });
    if (!row) return null;

    const bytes = await storage.get(key);
    if (!bytes) return null;

    return { bytes, mimeType: row.mimeType };
  },

  /**
   * The public branding view for one restaurant.
   *
   * Returns resolved URLs plus intrinsic dimensions — the latter so the
   * frontend can reserve space and avoid layout shift. Storage keys, filenames
   * and byte sizes stay internal.
   */
  async publicBranding(restaurantId: string) {
    const rows = await mediaRepository.findPublicByRestaurant(restaurantId);
    return toBranding(rows);
  },

  /**
   * Validates the bytes and reports what they actually are.
   *
   * Every decision here is made from the file's own content. The client's
   * filename and `Content-Type` are recorded and ignored respectively, because
   * both are attacker-chosen.
   */
  inspect(bytes: Uint8Array) {
    if (bytes.byteLength === 0) {
      throw new BadRequestError("The uploaded file is empty");
    }

    if (bytes.byteLength > config.media.maxBytes) {
      throw new BadRequestError(
        `Images must be ${Math.floor(config.media.maxBytes / 1_000_000)} MB or smaller`,
      );
    }

    const image = readImageInfo(bytes);
    if (!image) {
      throw new BadRequestError(
        `Unsupported image format. Accepted formats: ${SUPPORTED_FORMATS.join(", ")}`,
      );
    }

    const limit = config.media.maxDimension;
    if (image.width > limit || image.height > limit) {
      throw new BadRequestError(`Images must be at most ${limit}×${limit} pixels`);
    }

    return image;
  },

  /** Admin view: full metadata plus a resolved URL. */
  toAdminView(row: {
    id: string;
    purpose: MediaPurpose;
    storageKey: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    width: number;
    height: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const { storageKey, ...rest } = row;
    return { ...rest, url: storage.publicUrl(storageKey) };
  },
};

export interface PublicBranding {
  logo: { url: string; width: number; height: number } | null;
  banner: { url: string; width: number; height: number } | null;
}

/**
 * Shapes media rows into the public branding object.
 *
 * Absent media is `null`, never an omitted key: a consumer can then write
 * `branding.logo ? … : …` without having to distinguish "no logo" from "this
 * response predates branding".
 */
function toBranding(rows: PublicMediaRow[]): PublicBranding {
  const find = (purpose: MediaPurpose) => {
    const row = rows.find((candidate) => candidate.purpose === purpose);
    if (!row) return null;

    return {
      url: storage.publicUrl(row.storageKey),
      width: row.width,
      height: row.height,
    };
  };

  return { logo: find("LOGO"), banner: find("BANNER") };
}
