import Image from "next/image";
import type { BrandingImage } from "@/lib/api/restaurants";

/**
 * The restaurant's cover image, above the header.
 *
 * ─── Why `alt=""` ───────────────────────────────────────────────────────────
 *
 * A banner is decorative. Whatever it shows — the dining room, a dish, a
 * pattern — the page already states the restaurant's name in its `<h1>`
 * immediately below, so any alt text here would be a second, worse rendering of
 * information the reader already has. An empty `alt` is the correct, explicit
 * way to tell a screen reader to skip it; omitting the attribute entirely would
 * instead make some readers announce the filename.
 *
 * ─── Why the aspect ratio comes from the data ───────────────────────────────
 *
 * The API sends the intrinsic width and height, so the box can be sized before
 * a single byte of image arrives. Without that the header would jump downwards
 * as the banner loaded — the worst possible place for a layout shift, since it
 * pushes the menu the customer is reading.
 */
export function RestaurantBanner({ banner }: { banner: BrandingImage }) {
  return (
    <div
      className="relative w-full overflow-hidden bg-secondary"
      // The ratio is applied to the container rather than the image so the
      // reserved space is correct even before hydration or on a failed load.
      style={{ aspectRatio: `${banner.width} / ${banner.height}` }}
    >
      <Image
        src={banner.url}
        alt=""
        width={banner.width}
        height={banner.height}
        // The banner is the largest thing above the fold, so it is the LCP
        // element. `priority` stops Next lazy-loading it, which would otherwise
        // delay exactly the paint that matters most.
        priority
        // One column on every breakpoint, capped by the page's reading measure.
        sizes="100vw"
        className="h-full w-full object-cover"
      />
    </div>
  );
}
