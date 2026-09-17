import type { Metadata } from "next";
import { Card, CardContent, CardTitle } from "@repo/ui/card";
import { listCategories, listMenuItems } from "@/lib/api/menu";
import { listMedia } from "@/lib/api/media";
import { canDelete, getOperatingHours, getRestaurant } from "@/lib/api/restaurants";
import { BrandingSection } from "@/components/media/branding-section";
import { HoursForm } from "./hours-form";
import { RestaurantProfileForm } from "./restaurant-profile-form";

export const metadata: Metadata = { title: "Overview" };

interface PageProps {
  params: Promise<{ restaurantId: string }>;
}

export default async function RestaurantOverviewPage({ params }: PageProps) {
  const { restaurantId } = await params;

  // Independent reads, issued together rather than in sequence: the page is
  // then as slow as the slowest, not as slow as their sum.
  const [{ restaurant, role }, categories, items, hours, media] = await Promise.all([
    getRestaurant(restaurantId),
    listCategories(restaurantId),
    listMenuItems(restaurantId, { limit: 1 }),
    getOperatingHours(restaurantId),
    listMedia(restaurantId),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="summary-heading">
        <h2 id="summary-heading" className="sr-only">
          Menu summary
        </h2>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <SummaryCard label="Categories" value={categories.total} />
          <SummaryCard label="Menu items" value={items.total} />
          <SummaryCard
            label="Customer page"
            value={restaurant.isActive ? "Live" : "Hidden"}
          />
        </dl>
      </section>

      <section aria-labelledby="profile-heading">
        <Card>
          <CardContent className="p-4 sm:p-6">
            <CardTitle as="h2" id="profile-heading">
              Restaurant details
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              These appear on the public menu page, except where noted.
            </p>

            <div className="mt-6">
              <RestaurantProfileForm restaurant={restaurant} />
            </div>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="branding-heading">
        {/*
          Branding sits directly after the profile: a logo and a banner are
          part of a restaurant's identity, and an owner setting one up looks
          for them beside its name rather than behind another tab.

          `canDelete` comes from the role the API returned on this very
          request. Presentation only — the API enforces `media:delete`, and
          the control still handles a 403 if a role changes underneath.
        */}
        <BrandingSection
          restaurantId={restaurantId}
          media={media.items}
          canDelete={canDelete(role)}
        />
      </section>

      <section aria-labelledby="hours-heading">
        <Card>
          <CardContent className="p-4 sm:p-6">
            <CardTitle as="h2" id="hours-heading">
              Opening hours
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Shown on the customer menu page, along with whether you are open
              right now.
            </p>

            <div className="mt-6">
              <HoursForm
                restaurantId={restaurantId}
                days={hours.days}
                timeZone={restaurant.timeZone}
              />
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

/**
 * A `<dt>`/`<dd>` pair rather than two `<div>`s: a description list is what
 * this is, and it lets a screen reader pair the label with its value instead
 * of reading six disconnected strings.
 */
function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
