import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  formatDayHours,
  formatDayHoursLabel,
  type DayHours,
} from "@repo/ui/lib/opening-hours";
import type { PublicRestaurant } from "@/lib/api/restaurants";
import { OpenStatusBadge } from "./open-status-badge";
import { RestaurantHeader } from "./restaurant-header";
import { RestaurantHours } from "./restaurant-hours";
import { buildRestaurantJsonLd } from "./restaurant-json-ld";

afterEach(cleanup);

function day(
  dayOfWeek: DayHours["dayOfWeek"],
  overrides: Partial<DayHours> = {},
): DayHours {
  return {
    dayOfWeek,
    isClosed: false,
    opensAt: 540,
    closesAt: 1020,
    isOvernight: false,
    ...overrides,
  };
}

const fullWeek: DayHours[] = [
  day("MONDAY"),
  day("TUESDAY"),
  day("WEDNESDAY"),
  day("THURSDAY"),
  day("FRIDAY", { opensAt: 1320, closesAt: 120, isOvernight: true }),
  day("SATURDAY"),
  day("SUNDAY", { isClosed: true, opensAt: null, closesAt: null }),
];

describe("RestaurantHours", () => {
  test("renders every day of the week", () => {
    render(<RestaurantHours status="open" hours={fullWeek} timeZone="Asia/Kolkata" />);

    for (const name of ["Monday", "Friday", "Sunday"]) {
      expect(screen.getByText(name)).toBeDefined();
    }
  });

  test("is a labelled region with a heading", () => {
    render(<RestaurantHours status="open" hours={fullWeek} timeZone="Asia/Kolkata" />);

    expect(screen.getByRole("region", { name: "Opening hours" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "Opening hours" })).toBeDefined();
  });

  test("shows a closed day as the word 'Closed'", () => {
    render(<RestaurantHours status="closed" hours={fullWeek} timeZone="UTC" />);
    expect(screen.getByText("Closed")).toBeDefined();
  });

  /**
   * 22:00 – 02:00 would otherwise read as an invalid same-day interval. The
   * marker is text, not colour or an icon, so it survives greyscale and a
   * screen reader.
   */
  test("marks an overnight period so it does not look like a mistake", () => {
    render(<RestaurantHours status="open" hours={fullWeek} timeZone="UTC" />);

    // Compared against the shared formatter rather than a hard-coded string:
    // the component renders in the reader's locale, and this assertion is about
    // the component using it, not about which locale the suite happens to run in.
    const friday = fullWeek.find((d) => d.dayOfWeek === "FRIDAY") as DayHours;
    expect(screen.getByText(formatDayHours(friday))).toBeDefined();
    expect(screen.getByText("(next day)")).toBeDefined();
  });

  test("an overnight period is spelled out for assistive technology", () => {
    const { container } = render(
      <RestaurantHours status="open" hours={fullWeek} timeZone="UTC" />,
    );

    const friday = fullWeek.find((d) => d.dayOfWeek === "FRIDAY") as DayHours;
    const label = formatDayHoursLabel(friday);

    expect(label).toContain("the next day");
    expect(container.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
  });

  test("names the time zone, so the times are not read as the visitor's own", () => {
    render(<RestaurantHours status="open" hours={fullWeek} timeZone="Asia/Kolkata" />);
    expect(screen.getByText(/Asia\/Kolkata/)).toBeDefined();
  });

  /**
   * An unconfigured restaurant is not a closed one. Rendering an empty table or
   * a "Closed" badge would state something the platform does not know.
   */
  test("renders nothing at all when no hours are configured", () => {
    const { container } = render(
      <RestaurantHours status="unknown" hours={[]} timeZone="UTC" />,
    );

    expect(container.innerHTML).toBe("");
  });

  /** Days and their hours must be paired, not read as loose strings. */
  test("uses a description list so each day is paired with its hours", () => {
    const { container } = render(
      <RestaurantHours status="open" hours={fullWeek} timeZone="UTC" />,
    );

    const list = container.querySelector("dl");
    expect(list).not.toBeNull();
    expect(within(list as HTMLElement).getAllByRole("term")).toHaveLength(7);
  });
});

describe("OpenStatusBadge", () => {
  /** WCAG 1.4.1 — the state must never be carried by colour alone. */
  test.each([
    ["open", "Open now"],
    ["closed", "Closed now"],
  ] as const)("%s renders the words '%s'", (status, label) => {
    render(<OpenStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeDefined();
  });

  test("the coloured dot is hidden from assistive technology", () => {
    const { container } = render(<OpenStatusBadge status="open" />);
    const dot = container.querySelector("span[aria-hidden='true']");

    expect(dot).not.toBeNull();
  });

  test("is announced politely rather than interrupting", () => {
    render(<OpenStatusBadge status="open" />);
    expect(screen.getByRole("status")).toBeDefined();
  });

  /** No hours configured means no honest claim to make, so nothing is shown. */
  test("renders nothing for an unknown status", () => {
    const { container } = render(<OpenStatusBadge status="unknown" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("RestaurantHeader status", () => {
  const restaurant: PublicRestaurant = {
    id: "cms123",
    name: "Pizza Palace",
    slug: "pizza-palace",
    description: null,
    address: null,
    city: null,
    country: null,
    currency: "INR",
    timeZone: "Asia/Kolkata",
    status: "open",
    hours: fullWeek,
    branding: { logo: null, banner: null },
  };

  test("shows the status beside the name, where it is looked for first", () => {
    render(<RestaurantHeader restaurant={restaurant} />);
    expect(screen.getByText("Open now")).toBeDefined();
  });

  test("shows nothing when the restaurant has published no hours", () => {
    render(<RestaurantHeader restaurant={{ ...restaurant, status: "unknown", hours: [] }} />);

    expect(screen.queryByText(/Open now|Closed now/)).toBeNull();
  });
});

describe("JSON-LD opening hours", () => {
  const restaurant: PublicRestaurant = {
    id: "cms123",
    name: "Pizza Palace",
    slug: "pizza-palace",
    description: null,
    address: null,
    city: null,
    country: null,
    currency: "INR",
    timeZone: "Asia/Kolkata",
    status: "open",
    hours: fullWeek,
    branding: { logo: null, banner: null },
  };

  test("emits a specification per open day, in local wall-clock time", () => {
    const payload = buildRestaurantJsonLd(restaurant) as {
      openingHoursSpecification: { dayOfWeek: string; opens: string; closes: string }[];
    };

    // Six open days; Sunday is closed and therefore absent.
    expect(payload.openingHoursSpecification).toHaveLength(6);
    expect(payload.openingHoursSpecification[0]).toEqual({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: "Monday",
      opens: "09:00",
      closes: "17:00",
    } as never);
  });

  /**
   * A closed day emitted as 00:00–00:00 would be read by a search engine as
   * "open at midnight" rather than "shut".
   */
  test("omits closed days rather than emitting a zero-length period", () => {
    const payload = buildRestaurantJsonLd(restaurant) as {
      openingHoursSpecification: { dayOfWeek: string }[];
    };

    expect(payload.openingHoursSpecification.map((s) => s.dayOfWeek)).not.toContain("Sunday");
  });

  /** The overnight representation is preserved, not split or reordered. */
  test("keeps an overnight period as one entry with opens after closes", () => {
    const payload = buildRestaurantJsonLd(restaurant) as {
      openingHoursSpecification: { dayOfWeek: string; opens: string; closes: string }[];
    };
    const friday = payload.openingHoursSpecification.find((s) => s.dayOfWeek === "Friday");

    expect(friday).toEqual({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: "Friday",
      opens: "22:00",
      closes: "02:00",
    } as never);
  });

  /** Nothing invented: no hours key at all when none are published. */
  test("emits no hours when the restaurant has published none", () => {
    expect(buildRestaurantJsonLd({ ...restaurant, hours: [] })).not.toHaveProperty(
      "openingHoursSpecification",
    );
  });
});
