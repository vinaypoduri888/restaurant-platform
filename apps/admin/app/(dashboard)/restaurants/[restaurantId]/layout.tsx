import Link from "next/link";
import { notFound } from "next/navigation";
import { RestaurantNav } from "@/components/shell/restaurant-nav";
import { ForbiddenError, NotFoundError } from "@/lib/api/client";
import { canViewQr } from "@/lib/api/qr";
import { getRestaurant, type RestaurantWithRole } from "@/lib/api/restaurants";

/**
 * Shell for one restaurant: its name, its public link, and its section tabs.
 *
 * Loading the restaurant here rather than in each page means the name is
 * available to every child without repeating the call — React `cache`
 * de-duplicates it with the page's own read within the same render.
 */
export default async function RestaurantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  // Next 16 delivers route params as a Promise; they must be awaited.
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;
  const { restaurant, role } = await loadRestaurant(restaurantId);

  return (
    <div className="flex flex-1 flex-col">
      {/* Console chrome: useful on screen, noise on paper (see the QR print sheet). */}
      <div className="border-b border-border bg-card print:hidden">
        <div className="mx-auto w-full max-w-5xl px-5 pt-6 sm:px-6">
          <nav aria-label="Breadcrumb">
            <Link
              href="/"
              className="rounded-md text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              ← Your restaurants
            </Link>
          </nav>

          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-4">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {restaurant.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              /r/{restaurant.slug} · {restaurant.currency}
              {restaurant.isActive ? null : " · hidden from customers"}
            </p>
          </div>
        </div>

        <div className="mx-auto w-full max-w-5xl">
          <RestaurantNav restaurantId={restaurantId} showQr={canViewQr(role)} />
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl flex-1 px-5 py-6 sm:px-6 sm:py-8">{children}</div>
    </div>
  );
}

/**
 * Loads the restaurant, mapping "you may not see this" to a not-found page.
 *
 * The API answers `403` both for "you are not a member" and for "no such id",
 * deliberately, so that a signed-in user cannot probe for valid restaurant ids.
 * Rendering *not found* preserves that: the two cases stay indistinguishable,
 * and the response carries an honest 404 rather than the 500 an uncaught error
 * would produce.
 *
 * Everything else — a timeout, a 5xx — is rethrown to `error.tsx`, because
 * "temporarily broken" and "not yours" need different words and a different
 * next step.
 */
async function loadRestaurant(restaurantId: string): Promise<RestaurantWithRole> {
  try {
    return await getRestaurant(restaurantId);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }
}
