import { cache } from "react";
import type { Money } from "@repo/ui/lib/money";
import { apiGet } from "./client";
import { restaurantTag } from "./restaurants";

/**
 * The published menu, mirroring exactly what `GET /restaurants/{slug}/menu`
 * returns. Verified against the live API and the OpenAPI document, not assumed.
 *
 * Note what is deliberately absent, because the backend excludes it from the
 * public projection: `isActive`, `position`, `restaurantId`, `categoryId`,
 * timestamps, and the raw `priceMinor`. There is also no image field — no such
 * column exists in the schema yet.
 */
export interface PublicMenuItem {
  id: string;
  name: string;
  description: string | null;
  /** Exact integer minor units plus the currency and its exponent. */
  price: Money;
  /**
   * `false` means sold out *today*. Such items are still returned by the API
   * on purpose — a customer who cannot find yesterday's dish assumes the menu
   * is broken — so the UI must show them, marked, rather than filter them out.
   */
  isAvailable: boolean;
}

export interface PublicMenuCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  menuItems: PublicMenuItem[];
}

export interface PublicMenu {
  restaurant: { id: string; name: string; slug: string };
  categories: PublicMenuCategory[];
}

/**
 * Fetches one restaurant's published menu.
 *
 * Tagged with the *same* `restaurant:{slug}` tag as the restaurant record
 * rather than a second tag of its own. There is one subject here — a
 * restaurant — and one eventual webhook should invalidate everything about it;
 * a second tag with no consumer would be speculation, and the existing tag
 * strategy already covers this case.
 *
 * Wrapped in React `cache` so a page and any other consumer in the same render
 * share one request.
 */
export const getRestaurantMenu = cache(
  async (slug: string): Promise<PublicMenu> =>
    apiGet<PublicMenu>(`/restaurants/${encodeURIComponent(slug)}/menu`, {
      revalidate: 60,
      tags: [restaurantTag(slug)],
    }),
);

/**
 * Whether the menu has anything at all to show.
 *
 * A restaurant with categories that all happen to be empty is, to a customer,
 * indistinguishable from one with no categories: there is nothing to read. Both
 * must reach the empty state rather than rendering a column of bare headings.
 */
export function isMenuEmpty(menu: PublicMenu): boolean {
  return menu.categories.every((category) => category.menuItems.length === 0);
}

/**
 * Categories worth rendering a section and a nav entry for.
 *
 * An empty category is dropped rather than shown as a heading with nothing
 * under it — on a phone that reads as a loading failure.
 */
export function visibleCategories(menu: PublicMenu): PublicMenuCategory[] {
  return menu.categories.filter((category) => category.menuItems.length > 0);
}

/**
 * A DOM id for a category section, used by the in-page navigation.
 *
 * Derived from the API's own slug — already `[a-z0-9-]+` and unique within a
 * restaurant — with a prefix so it cannot collide with an id used elsewhere in
 * the document.
 */
export function categoryElementId(category: PublicMenuCategory): string {
  return `menu-category-${category.slug}`;
}
