import { formatLocation, type PublicRestaurant } from "@/lib/api/restaurants";
import { OpenStatusBadge } from "./open-status-badge";
import { RestaurantBanner } from "./restaurant-banner";
import { RestaurantLogo } from "./restaurant-logo";

/**
 * The first thing a customer sees after scanning a code at the table.
 *
 * Its whole job is to answer "what restaurant am I looking at?" within a
 * glance, so the name is the largest element on the page and is the document's
 * single `<h1>`.
 *
 * Renders only fields the public API actually returns. There is deliberately
 * no phone or email: the backend excludes contact details from the public
 * projection. A logo and banner are rendered when the restaurant has uploaded
 * them, and their absence is a fully-supported normal state rather than a
 * degraded one.
 */
export function RestaurantHeader({ restaurant }: { restaurant: PublicRestaurant }) {
  const location = formatLocation(restaurant);

  return (
    <header className="border-b border-border bg-card">
      {/*
        The banner when there is one, otherwise the slim brand band that has
        always been here. The band is not a placeholder for a missing image —
        it is the correct presentation for a restaurant that has not uploaded
        one, which `FRONTEND_SPEC.md` §17 requires be a fully-supported state
        rather than a degraded fallback.
      */}
      {restaurant.branding.banner ? (
        <RestaurantBanner banner={restaurant.branding.banner} />
      ) : (
        <div aria-hidden="true" className="h-1.5 w-full bg-primary" />
      )}

      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
        {/*
          The logo sits beside the name rather than above it, so the two read
          as one identity block and the name stays the first thing in the
          document order. `items-start` keeps them aligned when the name wraps
          to two lines on a narrow screen.
        */}
        <div className="flex items-start gap-4">
          {restaurant.branding.logo ? (
            <RestaurantLogo
              logo={restaurant.branding.logo}
              restaurantName={restaurant.name}
            />
          ) : null}

          <div className="min-w-0">
            <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {restaurant.name}
          </h1>
          </div>
        </div>

        {/*
          Repeated from the hours section on purpose: "is it open?" is the
          question someone asks before scrolling, and the full week is further
          down the page. Renders nothing when no hours are configured.
        */}
        <div className="mt-3">
          <OpenStatusBadge status={restaurant.status} />
        </div>

        {restaurant.description ? (
          <p className="mt-3 max-w-prose text-pretty text-base leading-relaxed text-muted-foreground sm:mt-4 sm:text-lg">
            {restaurant.description}
          </p>
        ) : null}

        {location ? (
          <p className="mt-5 flex items-start gap-2 text-sm text-muted-foreground sm:text-base">
            {/* Decorative: the visible text already carries the meaning. */}
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-0.5 size-4 shrink-0"
            >
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            {/* Spelled out for screen readers, which cannot infer it from a pin icon. */}
            <span className="sr-only">Location: </span>
            <span>{location}</span>
          </p>
        ) : null}
      </div>
    </header>
  );
}
