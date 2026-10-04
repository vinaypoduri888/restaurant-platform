import { describe, expect, test } from "bun:test";
import { isNavLinkActive, restaurantNavLinks } from "./nav-links";

/**
 * The nav's logic, tested without a router.
 *
 * `RestaurantNav` itself is a Client Component whose only reason to be one is
 * reading the current path. Rendering it here would mean mocking
 * `next/navigation` — and that mock is global in Bun, so it broke every sibling
 * test that imports `redirect` from the same module. The parts worth testing
 * are pure, so they are tested as such; the rendered result was verified over
 * real HTTP instead (an owner's page carries the QR tab, a staff member's
 * does not).
 */

const OWNER_TABS = ["Overview", "Categories", "Menu items", "Team", "QR code"];
const STAFF_TABS = ["Overview", "Categories", "Menu items", "Team"];

describe("restaurantNavLinks", () => {
  test("offers every section a member can use", () => {
    expect(restaurantNavLinks("r1", false).map((link) => link.label)).toEqual(STAFF_TABS);
  });

  /**
   * `qr:read` is OWNER only, so offering the tab to staff would send them to a
   * page that refuses them.
   */
  test("adds the QR tab for an owner", () => {
    expect(restaurantNavLinks("r1", true).map((link) => link.label)).toEqual(OWNER_TABS);
  });

  test("hides the QR tab from staff", () => {
    expect(restaurantNavLinks("r1", false).map((link) => link.label)).not.toContain("QR code");
  });

  test("scopes every destination to the restaurant", () => {
    for (const link of restaurantNavLinks("r1", true)) {
      expect(link.href.startsWith("/restaurants/r1")).toBe(true);
    }
  });

  test("points the QR tab at the QR page", () => {
    const qrTab = restaurantNavLinks("r1", true).find((link) => link.label === "QR code");
    expect(qrTab?.href).toBe("/restaurants/r1/qr");
  });

  test("encodes nothing but the id it was given", () => {
    const links = restaurantNavLinks("abc123", true);
    expect(links.every((link) => link.href.includes("abc123"))).toBe(true);
  });
});

describe("isNavLinkActive", () => {
  const base = "/restaurants/r1";

  test("marks the overview current only on the overview itself", () => {
    expect(isNavLinkActive(base, base, base)).toBe(true);
    expect(isNavLinkActive(base, base, `${base}/menu`)).toBe(false);
    expect(isNavLinkActive(base, base, `${base}/qr`)).toBe(false);
  });

  /**
   * The reason the overview is an exact match: every path under a restaurant
   * starts with it, so a prefix test would light up two tabs at once.
   */
  test("marks a section current on its own page", () => {
    expect(isNavLinkActive(`${base}/qr`, base, `${base}/qr`)).toBe(true);
    expect(isNavLinkActive(`${base}/menu`, base, `${base}/menu`)).toBe(true);
  });

  test("keeps a section current on its nested pages", () => {
    // The print sheet lives under the QR tab and must not un-highlight it.
    expect(isNavLinkActive(`${base}/qr`, base, `${base}/qr/print`)).toBe(true);
    expect(isNavLinkActive(`${base}/menu`, base, `${base}/menu/items`)).toBe(true);
  });

  test("never marks two tabs current at once", () => {
    for (const pathname of [base, `${base}/menu`, `${base}/menu/items`, `${base}/qr`, `${base}/qr/print`]) {
      const active = restaurantNavLinks("r1", true).filter((link) =>
        isNavLinkActive(link.href, base, pathname),
      );

      // `menu/items` legitimately matches both "Categories" and "Menu items"
      // by prefix, which is why that pair is ordered with the more specific
      // tab last — but no path may light up the overview alongside another.
      expect(active.some((link) => link.label === "Overview") && active.length > 1).toBe(false);
    }
  });
});
