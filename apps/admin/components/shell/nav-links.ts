/**
 * The restaurant navigation's logic, with no React and no router.
 *
 * ─── Why this is a separate module ──────────────────────────────────────────
 *
 * `restaurant-nav.tsx` imports `usePathname` from `next/navigation`, and that
 * module has no such export outside a browser build — importing the component
 * in a test fails at module load, before any test body runs. Mocking
 * `next/navigation` is not a way out either: Bun's module mocks are global, so
 * the mock broke every sibling test that imports `redirect` from it.
 *
 * Keeping the decisions here means they can be tested directly, and the
 * component is left as what it should be: markup plus one hook.
 */

export interface RestaurantNavLink {
  href: string;
  label: string;
}

/**
 * The tabs for one restaurant.
 *
 * `showQr` reflects `qr:read`, which is OWNER only. Offering the tab to staff
 * would send them to a page that refuses them — presentation only, since the
 * page handles a 403 regardless. A role can be revoked between this rendering
 * and the link being followed, so the console is never the authority.
 */
export function restaurantNavLinks(restaurantId: string, showQr: boolean): RestaurantNavLink[] {
  const base = `/restaurants/${restaurantId}`;

  return [
    { href: base, label: "Overview" },
    { href: `${base}/menu`, label: "Categories" },
    { href: `${base}/menu/items`, label: "Menu items" },
    /*
     * Team is offered to everyone, unlike the QR tab: `member:read` is held by
     * STAFF as well, so the page renders for them — as a roster with no
     * controls.
     */
    { href: `${base}/team`, label: "Team" },
    ...(showQr ? [{ href: `${base}/qr`, label: "QR code" }] : []),
  ];
}

/**
 * Whether a tab is the one being viewed.
 *
 * Exact match for the overview, prefix match for the rest, so a nested page —
 * the QR print sheet, say — keeps its parent tab highlighted. The overview has
 * to be exact because every path under a restaurant begins with it, and a
 * prefix test would light it up on every page.
 */
export function isNavLinkActive(href: string, base: string, pathname: string): boolean {
  return href === base ? pathname === base : pathname.startsWith(href);
}
