import { config } from "../../config.ts";
import { renderQrSvg } from "../../shared/qr/index.ts";
import { membershipService } from "../auth/membership.service.ts";
import { restaurantService } from "../restaurants/restaurant.service.ts";

/**
 * QR codes for a restaurant's public menu.
 *
 * ─── Nothing is stored ──────────────────────────────────────────────────────
 *
 * A QR code here is a pure function of the restaurant's current slug and the
 * configured public site URL. Both are already in the database or the
 * environment, and encoding is deterministic and fast, so storing the image
 * would add a second copy of a derived value — one that goes stale the moment
 * the slug changes, and has to be invalidated, migrated and cleaned up.
 *
 * Generating on demand means the code shown is, by construction, the code for
 * the current URL. `RestaurantMedia` exists for files a person uploaded and
 * the server could not otherwise reproduce; a QR code is the opposite of that.
 *
 * ─── The target is never taken from the caller ──────────────────────────────
 *
 * The URL encoded is assembled from the restaurant's own stored slug and a
 * configured origin. There is no parameter through which a caller can influence
 * it — the alternative, accepting a URL to encode, would turn this endpoint
 * into a service for minting QR codes that point anywhere, under the
 * restaurant's own domain and branding.
 */
export const qrService = {
  /**
   * The QR code for a restaurant the caller may administer.
   *
   * Authorization happens twice, deliberately. `qr:read` is checked here
   * because this module owns that policy, and `restaurantService.getForUser`
   * checks `restaurant:read` again when it loads the record. The second check
   * is redundant for a caller who passed the first, and costs one indexed
   * lookup on an endpoint a person hits by hand — far cheaper than either an
   * unauthorised accessor on the restaurant service or this module reaching
   * into another module's repository.
   */
  async getForUser(userId: string, restaurantId: string) {
    await membershipService.authorize(userId, restaurantId, "qr:read");

    const { restaurant } = await restaurantService.getForUser(userId, restaurantId);
    const targetUrl = publicMenuUrl(restaurant.slug);

    return {
      targetUrl,
      /** Suggested filename for a download; safe because the slug is. */
      fileName: `${restaurant.slug}-menu-qr.svg`,
      svg: renderQrSvg(targetUrl, { title: `${restaurant.name} menu QR code` }),
    };
  },
};

/**
 * The customer-facing URL for a slug.
 *
 * `/r/{slug}` mirrors `apps/web`'s routing. The slug needs no escaping — the
 * database `CHECK` constraint restricts it to lowercase letters, digits and
 * hyphens — but it is encoded anyway, because relying on a constraint declared
 * in another layer to keep this string URL-safe is exactly the assumption that
 * stops being true when someone adds a write path.
 */
export function publicMenuUrl(slug: string): string {
  return `${config.publicWebBaseUrl}/r/${encodeURIComponent(slug)}`;
}
