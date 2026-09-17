import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@repo/ui/badge";
import { Card, CardContent } from "@repo/ui/card";
import { listRestaurants } from "@/lib/api/restaurants";

export const metadata: Metadata = { title: "Your restaurants" };

/**
 * The entry point after signing in.
 *
 * With exactly one restaurant it redirects straight into it. Most users have
 * one, and making them click through a list of one is a step that exists only
 * because the list component does.
 *
 * The list is scoped by the API to the caller's memberships — this app does no
 * filtering of its own, and could not do it correctly if it tried.
 */
export default async function RestaurantsPage() {
  const { items: restaurants } = await listRestaurants();

  if (restaurants.length === 1 && restaurants[0]) {
    redirect(`/restaurants/${restaurants[0].id}`);
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Your restaurants</h1>
        <p className="text-sm text-muted-foreground">
          {restaurants.length === 0
            ? "Create a restaurant to start building its menu."
            : "Choose a restaurant to manage its profile and menu."}
        </p>
      </header>

      {restaurants.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-3">
          {restaurants.map((restaurant) => (
            <li key={restaurant.id}>
              <Card>
                <Link
                  href={`/restaurants/${restaurant.id}`}
                  className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <CardContent className="flex items-center justify-between gap-4 p-4 sm:p-6">
                    <div className="min-w-0">
                      <p className="truncate text-base font-medium text-foreground">
                        {restaurant.name}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">/r/{restaurant.slug}</p>
                    </div>

                    {/*
                      Text, not a colour dot. A status conveyed only by colour
                      is invisible to a screen reader and to a colour-blind
                      user (WCAG 1.4.1).
                    */}
                    {restaurant.isActive ? (
                      <Badge variant="success">Live</Badge>
                    ) : (
                      <Badge variant="neutral">Hidden</Badge>
                    )}
                  </CardContent>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <div>
        <Link
          href="/restaurants/new"
          className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Add a restaurant
        </Link>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-2 p-6">
        <p className="text-base font-medium text-foreground">No restaurants yet</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          The restaurant you create becomes yours to manage — you&apos;ll be its
          owner, and you can add categories and menu items straight away.
        </p>
      </CardContent>
    </Card>
  );
}
