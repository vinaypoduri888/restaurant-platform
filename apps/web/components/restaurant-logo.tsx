import Image from "next/image";
import type { BrandingImage } from "@/lib/api/restaurants";

/**
 * The restaurant's logo, beside its name in the header.
 *
 * ─── Why the alt text is what it is ─────────────────────────────────────────
 *
 * `alt="<name> logo"` rather than `alt=""`. Unlike the banner, a logo carries
 * identity: it is the thing a customer recognises when they glance at a page
 * after scanning a code, and a screen-reader user should be told it is present.
 * It is not `alt="<name>"` alone either — that would read the restaurant's name
 * twice in a row, since the `<h1>` sits immediately beside it.
 *
 * Rendered at a fixed display size with the intrinsic dimensions passed
 * through, so Next can serve an appropriately-sized file while the box stays
 * reserved.
 */
export function RestaurantLogo({
  logo,
  restaurantName,
}: {
  logo: BrandingImage;
  restaurantName: string;
}) {
  return (
    <div
      className="relative size-16 shrink-0 overflow-hidden rounded-lg border border-border bg-card sm:size-20"
      // Reserved by the utility classes above rather than by the image itself,
      // so the space is held even if the file never loads.
    >
      <Image
        src={logo.url}
        alt={`${restaurantName} logo`}
        width={logo.width}
        height={logo.height}
        // Two fixed sizes, matching the classes above, so the optimiser is
        // asked for roughly the pixels actually painted rather than the full
        // upload.
        sizes="(min-width: 640px) 80px, 64px"
        className="h-full w-full object-contain"
      />
    </div>
  );
}
