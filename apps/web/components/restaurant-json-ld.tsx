import { toTimeInputValue, type DayHours } from "@repo/ui/lib/opening-hours";
import type { PublicRestaurant } from "@/lib/api/restaurants";

/**
 * Builds the schema.org payload from only the fields the API actually returns.
 *
 * No invented cuisine, price range, rating, or contact details — emitting
 * structured data the platform cannot substantiate would be both dishonest and
 * a rich-results violation. Opening hours are included only when the restaurant
 * has actually published them.
 *
 * Exported separately from the component so the escaping below can be tested
 * directly.
 */
export function buildRestaurantJsonLd(restaurant: PublicRestaurant): Record<string, unknown> {
  const hasAddress = Boolean(restaurant.address || restaurant.city || restaurant.country);

  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: restaurant.name,
    ...(restaurant.description ? { description: restaurant.description } : {}),
    ...(hasAddress
      ? {
          address: {
            "@type": "PostalAddress",
            ...(restaurant.address ? { streetAddress: restaurant.address } : {}),
            ...(restaurant.city ? { addressLocality: restaurant.city } : {}),
            ...(restaurant.country ? { addressCountry: restaurant.country } : {}),
          },
        }
      : {}),
    /*
     * `image` is emitted only when a logo genuinely exists, and only ever as
     * the public URL the API resolved. schema.org treats `image` as the
     * representative picture of the place, which is exactly what a logo is.
     *
     * The banner is deliberately not used here: it is decorative, chosen for
     * how it looks across the top of a page rather than to represent the
     * business, and cropping means it may not even show the restaurant. No
     * internal metadata — no key, no filename, no dimensions — goes into
     * structured data.
     */
    ...(restaurant.branding.logo ? { image: restaurant.branding.logo.url } : {}),
    ...buildOpeningHours(restaurant.hours),
  };
}

/**
 * `openingHoursSpecification`, emitted only when hours genuinely exist.
 *
 * schema.org expects local wall-clock `HH:MM`, which is exactly what is stored,
 * so no conversion happens here. An overnight period is represented as it is —
 * `opens` later than `closes` — which is the documented representation for a
 * period that runs past midnight; splitting it would misstate the hours.
 *
 * Closed days are omitted rather than emitted as 00:00–00:00, which search
 * engines read as "open at midnight" rather than "shut".
 */
function buildOpeningHours(hours: DayHours[]): Record<string, unknown> {
  const open = hours.filter(
    (day) => !day.isClosed && day.opensAt !== null && day.closesAt !== null,
  );

  if (open.length === 0) return {};

  return {
    openingHoursSpecification: open.map((day) => ({
      "@type": "OpeningHoursSpecification",
      // schema.org uses capitalised English day names.
      dayOfWeek: `${day.dayOfWeek[0]}${day.dayOfWeek.slice(1).toLowerCase()}`,
      opens: toTimeInputValue(day.opensAt as number),
      closes: toTimeInputValue(day.closesAt as number),
    })),
  };
}

/**
 * Serialises the payload for embedding in a `<script>` tag.
 *
 * The `<` escaping is a security control, not formatting. `JSON.stringify`
 * escapes quotes and backslashes but leaves `<` untouched, so a restaurant
 * named `</script><script>…` would otherwise break out of the script element
 * and execute — a stored XSS against every customer who scans that table's
 * code. Restaurant names are owner-controlled input, so this is a real vector.
 *
 * `<` is valid JSON and parses back to `<`, so structured data still works.
 */
export function serializeJsonLd(payload: Record<string, unknown>): string {
  return JSON.stringify(payload).replace(/</g, "\\u003c");
}

export function RestaurantJsonLd({ restaurant }: { restaurant: PublicRestaurant }) {
  return (
    <script
      type="application/ld+json"
      // Safe: the content is JSON we generated, with `<` neutralised above.
      // This is the one sanctioned use of dangerouslySetInnerHTML in this app
      // (see FRONTEND_SPEC.md §21) and matches Next.js's documented approach.
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildRestaurantJsonLd(restaurant)) }}
    />
  );
}
