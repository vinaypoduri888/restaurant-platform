import { cache } from "react";
import type { DayHours, OpenStatus } from "@repo/ui/lib/opening-hours";
import { apiGet } from "./client";

/**
 * The public restaurant shape, mirroring exactly what
 * `GET /restaurants/{slug}` returns.
 *
 * This is the API's deliberate public projection — verified against
 * `PUBLIC_RESTAURANT_FIELDS` in the backend. Note what is NOT here:
 *
 *   - `email` / `phone`  — excluded by the backend on purpose; they are the
 *                          restaurant's own contact data, not public listing
 *                          information.
 *   - `isActive`         — inactive restaurants 404 instead of being returned.
 *   - timestamps         — internal bookkeeping.
 *   - storage keys       — `branding` carries resolved URLs instead, so the
 *                          storage layout is never exposed.
 *
 * Every field except `id`, `name`, and `slug` is nullable, so the UI must treat
 * absence as the normal case rather than an edge case.
 */
export interface PublicRestaurant {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  /** ISO 4217 code the menu is priced in. */
  currency: string;
  /** IANA zone the hours below are expressed in, e.g. `Asia/Kolkata`. */
  timeZone: string;
  /**
   * Whether the restaurant is open, computed by the **API** from its own time
   * zone at request time — never in the browser, which knows only the
   * visitor's location.
   *
   * `unknown` means no hours have been configured. Deliberately not `closed`:
   * an owner who has not filled the form in has not said they are shut.
   */
  status: OpenStatus;
  /** The published week, Monday first. Empty when nothing is configured. */
  hours: DayHours[];
  /**
   * Uploaded branding, with URLs the API resolved from whichever storage
   * driver it is configured with. Either slot is `null` when nothing has been
   * uploaded — never an omitted key, so the UI can branch without having to
   * distinguish "no logo" from "an older response shape".
   */
  branding: PublicBranding;
}

/**
 * One branding image.
 *
 * The intrinsic dimensions travel with the URL specifically so the page can
 * reserve space before the bytes arrive. Without them every image would shift
 * the layout as it loaded — worst on exactly the slow connection this product
 * is designed for.
 */
export interface BrandingImage {
  url: string;
  width: number;
  height: number;
}

export interface PublicBranding {
  logo: BrandingImage | null;
  banner: BrandingImage | null;
}

/** Cache tag for one restaurant, so a future mutation webhook can target it. */
export function restaurantTag(slug: string): string {
  return `restaurant:${slug}`;
}

/**
 * Fetches one publicly visible restaurant by slug.
 *
 * Wrapped in React `cache` so that the page and `generateMetadata` — which both
 * need the same record during a single render — share one request instead of
 * issuing two.
 *
 * Throws `ResourceNotFoundError` when the restaurant does not exist or is
 * inactive, and `ApiUnavailableError` for every other failure. Callers decide
 * how to present those; this layer never renders anything.
 */
export const getRestaurantBySlug = cache(
  async (slug: string): Promise<PublicRestaurant> =>
    apiGet<PublicRestaurant>(`/restaurants/${encodeURIComponent(slug)}`, {
      revalidate: 60,
      tags: [restaurantTag(slug)],
    }),
);

/**
 * The canonical path for a restaurant, if the request did not arrive on it.
 *
 * The API resolves retired slugs as well as current ones and always reports the
 * restaurant's current `slug`, so a mismatch with the slug that was asked for
 * is exactly the signal that this request came in on an old URL — a QR code
 * printed before a rename.
 *
 * Returns `null` when the request is already canonical, so the caller does not
 * redirect to the page it is already on. That is the case worth being careful
 * about: redirecting to the current URL is an infinite loop.
 */
export function canonicalPathFor(
  requestedSlug: string,
  restaurant: Pick<PublicRestaurant, "slug">,
): string | null {
  return restaurant.slug === requestedSlug ? null : `/r/${restaurant.slug}`;
}

/**
 * Joins the location parts the API actually provides, skipping absent ones.
 *
 * Returns `null` when nothing is available, which lets callers omit the whole
 * location block rather than rendering an empty heading or stray punctuation.
 */
export function formatLocation(restaurant: PublicRestaurant): string | null {
  const parts = [restaurant.address, restaurant.city, restaurant.country]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(", ") : null;
}
