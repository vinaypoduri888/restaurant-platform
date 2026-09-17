import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { PublicMenu } from "@/lib/api/menu";
import type { PublicRestaurant } from "@/lib/api/restaurants";
import { MenuSection } from "./menu-section";
import { MenuUnavailable } from "./menu-unavailable";
import { RestaurantHeader } from "./restaurant-header";
import { buildRestaurantJsonLd, serializeJsonLd } from "./restaurant-json-ld";

afterEach(cleanup);

const full: PublicRestaurant = {
  id: "cms123",
  name: "Pizza Palace",
  slug: "pizza-palace",
  description: "Wood-fired since 1998.",
  address: "12 Market Street",
  city: "Mumbai",
  country: "India",
  currency: "INR",
  timeZone: "Asia/Kolkata",
  status: "open",
  hours: [],
  branding: { logo: null, banner: null },
};

/** Only the three non-nullable fields — the realistic minimum record. */
const minimal: PublicRestaurant = {
  id: "cms999",
  name: "Corner Cafe",
  slug: "corner-cafe",
  description: null,
  address: null,
  city: null,
  country: null,
  currency: "INR",
  timeZone: "Asia/Kolkata",
  status: "open",
  hours: [],
  branding: { logo: null, banner: null },
};

describe("RestaurantHeader", () => {
  test("renders the restaurant name as the page's single h1", () => {
    render(<RestaurantHeader restaurant={full} />);
    expect(screen.getByRole("heading", { level: 1, name: "Pizza Palace" })).toBeDefined();
  });

  test("renders the description when present", () => {
    render(<RestaurantHeader restaurant={full} />);
    expect(screen.getByText("Wood-fired since 1998.")).toBeDefined();
  });

  test("renders the combined location", () => {
    render(<RestaurantHeader restaurant={full} />);
    expect(screen.getByText("12 Market Street, Mumbai, India")).toBeDefined();
  });

  test("labels the location for screen readers, which cannot read a pin icon", () => {
    render(<RestaurantHeader restaurant={full} />);
    expect(screen.getByText(/^Location:/)).toBeDefined();
  });

  /**
   * Every optional field is nullable in the API, so a sparse record is the
   * normal case rather than an edge case.
   */
  test("renders a name-only restaurant without empty sections", () => {
    render(<RestaurantHeader restaurant={minimal} />);

    expect(screen.getByRole("heading", { level: 1, name: "Corner Cafe" })).toBeDefined();
    expect(screen.queryByText(/^Location:/)).toBeNull();
  });

  test("omits the location block when only whitespace is provided", () => {
    render(<RestaurantHeader restaurant={{ ...minimal, city: "  " }} />);
    expect(screen.queryByText(/^Location:/)).toBeNull();
  });

  /**
   * The public API deliberately excludes contact details. Rendering them would
   * mean the frontend had invented data the backend refuses to expose.
   */
  test("never renders contact details, which are not in the public contract", () => {
    const { container } = render(<RestaurantHeader restaurant={full} />);
    expect(container.textContent).not.toContain("@");
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  test("decorative icon is hidden from assistive technology", () => {
    const { container } = render(<RestaurantHeader restaurant={full} />);
    for (const svg of container.querySelectorAll("svg")) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
  });
});

const emptyMenu: PublicMenu = {
  restaurant: { id: "cms123", name: "Pizza Palace", slug: "pizza-palace" },
  categories: [],
};

describe("MenuSection", () => {
  test("renders a labelled menu region with an h2", () => {
    render(<MenuSection menu={emptyMenu} />);
    expect(screen.getByRole("heading", { level: 2, name: "Menu" })).toBeDefined();
    expect(screen.getByRole("region", { name: "Menu" })).toBeDefined();
  });

  test("shows the empty state when nothing is published", () => {
    render(<MenuSection menu={emptyMenu} />);
    expect(screen.getByText(/isn't published yet/i)).toBeDefined();
  });
});

describe("MenuUnavailable", () => {
  /**
   * This is the crux of the empty-vs-error distinction: nothing has failed, so
   * it must not be announced assertively or styled as a problem.
   */
  test("is not an error state", () => {
    render(<MenuUnavailable />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("tells the customer what to do next", () => {
    render(<MenuUnavailable />);
    expect(screen.getByText(/ask a\s+member of staff/i)).toBeDefined();
  });
});

describe("Restaurant JSON-LD", () => {
  test("includes only fields the API actually returns", () => {
    const payload = buildRestaurantJsonLd(full) as Record<string, unknown>;

    expect(payload["@type"]).toBe("Restaurant");
    expect(payload.name).toBe("Pizza Palace");
    // Nothing invented: no cuisine, rating, price range, or hours.
    expect(payload).not.toHaveProperty("servesCuisine");
    expect(payload).not.toHaveProperty("aggregateRating");
    expect(payload).not.toHaveProperty("priceRange");
    expect(payload).not.toHaveProperty("openingHours");
    expect(payload).not.toHaveProperty("telephone");
  });

  test("omits the address entirely when no location data exists", () => {
    expect(buildRestaurantJsonLd(minimal)).not.toHaveProperty("address");
  });

  /**
   * Security regression. Restaurant names are owner-controlled, and
   * `JSON.stringify` does not escape `<`, so an unescaped payload would let a
   * name close the script tag and execute arbitrary JavaScript against every
   * customer who scanned that table's code.
   */
  test("escapes < so a crafted name cannot break out of the script tag", () => {
    const hostile: PublicRestaurant = {
      ...minimal,
      name: '</script><script>alert(1)</script>',
    };

    const serialized = serializeJsonLd(buildRestaurantJsonLd(hostile));

    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c");
    // Still valid JSON that round-trips to the original value.
    expect((JSON.parse(serialized) as { name: string }).name).toBe(hostile.name);
  });
});
