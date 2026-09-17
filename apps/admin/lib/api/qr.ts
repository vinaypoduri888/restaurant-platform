import { cache } from "react";
import { apiRequest } from "./client";
import type { MembershipRole } from "./restaurants";

/**
 * The restaurant's menu QR code, as the admin API returns it.
 *
 * Verified against the live endpoint. Note what is *not* here: no image id, no
 * storage key, no expiry. The API generates the code on demand from the
 * restaurant's current slug, so there is no stored artefact for this console to
 * track, refresh or invalidate.
 */
export interface RestaurantQr {
  /** The customer-facing URL the code encodes. */
  targetUrl: string;
  /** Suggested filename for a download. */
  fileName: string;
  /** A self-contained SVG document — no external references, no script. */
  svg: string;
}

/**
 * Fetches the QR code for a restaurant.
 *
 * Wrapped in React `cache` so a page and its metadata share one request, the
 * same as every other read in this app.
 *
 * Throws `ForbiddenError` for a caller without `qr:read` — which is every STAFF
 * member. Callers decide how to present that; this layer renders nothing.
 */
export const getRestaurantQr = cache(
  async (restaurantId: string): Promise<RestaurantQr> =>
    apiRequest<RestaurantQr>(`/admin/restaurants/${encodeURIComponent(restaurantId)}/qr`),
);

/**
 * Whether a role may see the QR code.
 *
 * Mirrors the backend's `qr:read` capability, which is OWNER only. Kept beside
 * `canDelete` in spirit: one place maps a role to what it can do, rather than
 * each component comparing against `"OWNER"` and drifting apart.
 *
 * **Not a security control.** It decides whether to offer the QR tab at all, so
 * a staff member is not sent to a page that will refuse them. The API enforces
 * the capability independently, and the page still handles a 403 — a role can
 * be revoked between the menu rendering and the link being followed.
 */
export function canViewQr(role: MembershipRole): boolean {
  return role === "OWNER";
}
