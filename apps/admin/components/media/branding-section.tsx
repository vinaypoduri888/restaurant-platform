import { Card, CardContent, CardTitle } from "@repo/ui/card";
import { findByPurpose, type AdminMedia } from "@/lib/api/media";
import { MediaSlot } from "./media-slot";

/**
 * The branding panel on the restaurant overview page.
 *
 * Slotted into the existing profile area rather than given a page of its own:
 * a logo and a banner are two fields of a restaurant's identity, and an owner
 * setting up a restaurant expects to find them beside its name, not behind
 * another tab.
 */
export function BrandingSection({
  restaurantId,
  media,
  canDelete,
}: {
  restaurantId: string;
  media: AdminMedia[];
  canDelete: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-6">
        <CardTitle as="h2" id="branding-heading">
          Branding
        </CardTitle>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Both are optional. The customer page is designed to look right with
          neither, so upload only what you actually have.
        </p>

        {/*
          Stacked on a phone, side by side from `sm` up. Two columns rather than
          three or a grid of thumbnails: there are exactly two slots, and a
          layout that could hold more would imply a gallery this product does
          not have.
        */}
        <div className="mt-6 grid gap-8 sm:grid-cols-2 sm:gap-6">
          <MediaSlot
            restaurantId={restaurantId}
            purpose="LOGO"
            heading="Logo"
            guidance="Shown beside your name at the top of the customer page. A square image works best."
            media={findByPurpose(media, "LOGO")}
            canDelete={canDelete}
          />

          <MediaSlot
            restaurantId={restaurantId}
            purpose="BANNER"
            heading="Banner"
            guidance="A wide cover image across the top of the customer page. It is cropped to fit, so keep anything important near the middle."
            media={findByPurpose(media, "BANNER")}
            canDelete={canDelete}
          />
        </div>
      </CardContent>
    </Card>
  );
}
