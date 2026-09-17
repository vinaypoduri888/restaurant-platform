import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MenuSection } from "@/components/menu-section";
import { RestaurantHeader } from "@/components/restaurant-header";
import { RestaurantHours } from "@/components/restaurant-hours";
import { RestaurantJsonLd } from "@/components/restaurant-json-ld";
import { ResourceNotFoundError } from "@/lib/api/client";
import { getRestaurantMenu, type PublicMenu } from "@/lib/api/menu";
import { formatLocation, getRestaurantBySlug } from "@/lib/api/restaurants";

/**
 * The QR destination: one renderer that serves every restaurant on the
 * platform. Nothing here is restaurant-specific — the slug selects the data and
 * the data drives the page.
 *
 * `generateStaticParams` is deliberately not used. Pre-rendering every
 * restaurant would tie build time to customer count and force a deploy to
 * publish a new restaurant. Dynamic rendering plus the cached fetch in the data
 * layer gives the same delivered speed without that coupling.
 */

interface PageProps {
  // Next 16 delivers route params as a Promise; they must be awaited.
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    // Shares the page's request via React `cache` — this does not double-fetch.
    const restaurant = await getRestaurantBySlug(slug);
    const location = formatLocation(restaurant);
    const description =
      restaurant.description ??
      (location
        ? `View the menu for ${restaurant.name} in ${location}.`
        : `View the menu for ${restaurant.name}.`);

    return {
      title: restaurant.name,
      description,
      alternates: { canonical: `/r/${restaurant.slug}` },
      openGraph: {
        type: "website",
        title: restaurant.name,
        description,
        url: `/r/${restaurant.slug}`,
      },
      twitter: { card: "summary", title: restaurant.name, description },
    };
  } catch {
    // Metadata must never break the page. Missing or unavailable restaurants
    // are handled by the page itself; a generic, non-indexable title is the
    // safe fallback here.
    return { title: "Restaurant", robots: { index: false, follow: false } };
  }
}

export default async function RestaurantPage({ params }: PageProps) {
  const { slug } = await params;

  let restaurant;
  try {
    restaurant = await getRestaurantBySlug(slug);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      // Covers both "no such restaurant" and "deactivated" — the API does not
      // distinguish them, and neither should the UI.
      notFound();
    }
    // Anything else is a genuine failure: rethrow so `error.tsx` takes over.
    throw error;
  }

  const menu = await loadMenu(slug);

  return (
    <article className="flex min-h-dvh flex-col bg-background">
      <RestaurantHeader restaurant={restaurant} />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-5 py-8 sm:px-8 sm:py-12 sm:gap-12">
        <MenuSection menu={menu} />

        {/*
          Hours sit after the menu: someone who has just scanned a code at the
          table wants the food first. The open/closed badge they need at a
          glance is repeated in the header.
        */}
        <RestaurantHours
          status={restaurant.status}
          hours={restaurant.hours}
          timeZone={restaurant.timeZone}
        />
      </div>

      <RestaurantJsonLd restaurant={restaurant} />
    </article>
  );
}

/**
 * Fetches the menu, converting any failure into `null` rather than throwing.
 *
 * This is the deliberate difference between the two requests on this page. The
 * restaurant is the page — without it there is nothing to show, so its failure
 * belongs to the error boundary. The menu is a *part* of the page, and a
 * customer standing at a table is better served by "here is the restaurant,
 * the menu didn't load" than by an error screen that discards what already
 * worked.
 *
 * A 404 lands here too. It should not be reachable — the restaurant lookup
 * immediately above would have 404'd first — but if the two requests ever
 * disagree (a restaurant deactivated between them), the inline notice is still
 * the right outcome, not a crash.
 */
async function loadMenu(slug: string): Promise<PublicMenu | null> {
  try {
    return await getRestaurantMenu(slug);
  } catch {
    // The data layer has already logged the detail server-side. Nothing about
    // the failure reaches the customer beyond the inline notice.
    return null;
  }
}
