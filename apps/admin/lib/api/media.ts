import { cache } from "react";
import { apiRequest } from "./client";

/**
 * Restaurant branding media, as the admin API returns it.
 *
 * Verified against the live endpoint rather than transcribed from a report.
 * Note there is no `storageKey`: the API resolves a public `url` instead, so
 * the console never learns the storage layout and never has to know whether a
 * file sits on a local disk or behind a CDN.
 */
export type MediaPurpose = "LOGO" | "BANNER";

export interface AdminMedia {
  id: string;
  restaurantId: string;
  purpose: MediaPurpose;
  /** Resolved public URL, built by the API from its configured storage driver. */
  url: string;
  /** The name the browser sent, kept so an owner recognises their own file. */
  originalName: string;
  /** Sniffed from the file's bytes by the API, not from the upload header. */
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
}

function mediaPath(restaurantId: string): string {
  return `/admin/restaurants/${encodeURIComponent(restaurantId)}/media`;
}

/**
 * Everything a restaurant has uploaded.
 *
 * Not paginated, because there is nothing to paginate: a restaurant holds at
 * most one logo and one banner, enforced by a unique constraint on
 * `(restaurantId, purpose)`.
 */
export const listMedia = cache(
  async (restaurantId: string): Promise<{ items: AdminMedia[] }> =>
    apiRequest<{ items: AdminMedia[] }>(mediaPath(restaurantId)),
);

/**
 * Uploads an image, replacing whatever currently holds that purpose.
 *
 * The body is `FormData`, forwarded untouched by the client so the runtime can
 * set the multipart boundary. The file never touches the browser's JavaScript
 * beyond the `<input>` element — it goes straight from the form post into a
 * server action and out to the API.
 */
export function uploadMedia(
  restaurantId: string,
  purpose: MediaPurpose,
  file: File,
): Promise<AdminMedia> {
  const body = new FormData();
  body.append("purpose", purpose);
  body.append("file", file);

  return apiRequest<AdminMedia>(mediaPath(restaurantId), { method: "POST", body });
}

/** Deletes one image. OWNER only — the API enforces `media:delete`. */
export function deleteMedia(restaurantId: string, mediaId: string): Promise<void> {
  return apiRequest<void>(`${mediaPath(restaurantId)}/${encodeURIComponent(mediaId)}`, {
    method: "DELETE",
  });
}

/**
 * Picks out one slot from the list.
 *
 * The API returns a flat array; the editor thinks in terms of "the logo" and
 * "the banner", so the mapping happens once here rather than in each component.
 */
export function findByPurpose(
  items: readonly AdminMedia[],
  purpose: MediaPurpose,
): AdminMedia | null {
  return items.find((item) => item.purpose === purpose) ?? null;
}
