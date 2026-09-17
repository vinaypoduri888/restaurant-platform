import type { Metadata } from "next";
import { Card, CardContent, CardTitle } from "@repo/ui/card";
import { QrPanel } from "@/components/qr/qr-panel";
import { ForbiddenError } from "@/lib/api/client";
import { getRestaurantQr, type RestaurantQr } from "@/lib/api/qr";
import { getRestaurant } from "@/lib/api/restaurants";

export const metadata: Metadata = { title: "QR code" };

interface PageProps {
  // Next 16 delivers route params as a Promise; they must be awaited.
  params: Promise<{ restaurantId: string }>;
}

export default async function QrPage({ params }: PageProps) {
  const { restaurantId } = await params;

  // The restaurant is loaded for its name; `getRestaurant` is `cache`d and the
  // layout has already fetched it, so this costs nothing.
  const [{ restaurant }, qr] = await Promise.all([
    getRestaurant(restaurantId),
    loadQr(restaurantId),
  ]);

  if (!qr) {
    return <OwnerOnlyNotice />;
  }

  return (
    <section aria-labelledby="qr-heading">
      <QrPanel restaurantId={restaurantId} restaurantName={restaurant.name} qr={qr} />
    </section>
  );
}

/**
 * Loads the QR code, treating a refusal as "not available to you".
 *
 * `qr:read` is OWNER only, so a staff member reaching this page gets a 403.
 * That is an expected answer rather than a failure, and it is handled here
 * whether or not the navigation offered the link — a role can be revoked
 * between the menu rendering and the page loading, and the console is never the
 * authority on what someone may see.
 *
 * Everything else — a timeout, a 5xx — is rethrown to `error.tsx`, because
 * "temporarily broken" needs different words and a different next step from
 * "not yours to see".
 */
async function loadQr(restaurantId: string): Promise<RestaurantQr | null> {
  try {
    return await getRestaurantQr(restaurantId);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return null;
    }
    throw error;
  }
}

/** Explains the refusal, and says who can act. */
function OwnerOnlyNotice() {
  return (
    <section aria-labelledby="qr-heading">
      <Card>
        <CardContent className="p-4 sm:p-6">
          <CardTitle as="h2" id="qr-heading">
            Menu QR code
          </CardTitle>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            Only an owner can view or print the QR code. A printed code fixes
            this restaurant&apos;s web address for as long as it is on the
            tables, so the decision to commit to one sits with the owner. Ask an
            owner of this restaurant to print it for you.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
