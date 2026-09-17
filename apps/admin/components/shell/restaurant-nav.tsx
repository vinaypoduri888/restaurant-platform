"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavLinkActive, restaurantNavLinks } from "./nav-links";

/**
 * Navigation within one restaurant.
 *
 * A Client Component solely to read the current path and mark the active tab.
 * The links themselves are `next/link` anchors and work without hydration.
 *
 * Horizontal tabs rather than a sidebar: there are at most four destinations,
 * and on a phone a sidebar would either cover the content or hide behind a menu
 * button — both worse than a row that fits and scrolls.
 */
export function RestaurantNav({
  restaurantId,
  showQr,
}: {
  restaurantId: string;
  /**
   * Whether to offer the QR tab. `qr:read` is OWNER only, so staff would
   * otherwise be sent to a page that refuses them.
   *
   * Presentation only — the page handles a 403 regardless, because a role can
   * be revoked between this rendering and the link being followed.
   */
  showQr: boolean;
}) {
  const pathname = usePathname();
  const base = `/restaurants/${restaurantId}`;
  const links = restaurantNavLinks(restaurantId, showQr);

  return (
    <nav aria-label="Restaurant sections" className="border-b border-border print:hidden">
      <ul className="-mb-px flex gap-1 overflow-x-auto px-5 sm:px-6">
        {links.map((link) => {
          const isActive = isNavLinkActive(link.href, base, pathname);

          return (
            <li key={link.href} className="shrink-0">
              <Link
                href={link.href}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "inline-flex h-11 items-center border-b-2 px-3 text-sm font-medium",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
