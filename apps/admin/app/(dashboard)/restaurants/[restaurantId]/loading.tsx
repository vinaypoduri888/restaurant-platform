import { Skeleton } from "@repo/ui/skeleton";

/**
 * Streamed while a restaurant's data is fetched.
 *
 * Deliberately restrained: three shapes standing in for the page's main blocks,
 * not a facsimile of every row. An elaborate skeleton costs more to keep in
 * step with the real layout than it returns, and when it drifts it produces the
 * layout shift it was supposed to prevent.
 *
 * The individual bars are `aria-hidden` via the `Skeleton` primitive; the
 * wrapper carries one polite status message so a screen reader hears "Loading"
 * once rather than announcing a dozen empty boxes.
 */
export default function RestaurantLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <p role="status" className="sr-only">
        Loading
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
      </div>

      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}
