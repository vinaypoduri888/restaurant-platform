import { z } from "zod";
import { resourceIdSchema } from "./common.ts";

/**
 * Restaurant branding media.
 *
 * The upload itself is `multipart/form-data`, so the file bytes are not
 * validated by Zod — a schema cannot say anything useful about a binary blob.
 * The API sniffs the real format from the bytes instead (`image-format.ts`).
 * What *is* validated here are the fields that travel alongside it, and the
 * path parameters.
 */

/**
 * What a piece of media is for. Mirrors the `MediaPurpose` database enum.
 *
 * A closed set, not free text: the public contract promises "the logo" and
 * "the banner", and an open vocabulary would let unrecognised purposes
 * accumulate rows that nothing renders.
 */
export const MEDIA_PURPOSES = ["LOGO", "BANNER"] as const;

export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

export const mediaPurposeSchema = z.enum(MEDIA_PURPOSES);

/**
 * The non-file part of an upload.
 *
 * `purpose` arrives as a form field, so it is a string on the wire; the enum
 * rejects anything else rather than coercing. There is deliberately no
 * `restaurantId` field — the restaurant comes from the authorized URL, and
 * accepting one here would create a second, forgeable source of truth.
 */
export const uploadMediaSchema = z.object({
  purpose: mediaPurposeSchema,
});

export const mediaParamSchema = z.object({
  restaurantId: resourceIdSchema,
  mediaId: resourceIdSchema,
});

export type UploadMediaInput = z.infer<typeof uploadMediaSchema>;
export type MediaParam = z.infer<typeof mediaParamSchema>;
