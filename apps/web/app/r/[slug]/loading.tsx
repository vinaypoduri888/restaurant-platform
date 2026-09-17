import { Skeleton } from "@repo/ui/skeleton";

/**
 * Streamed immediately while the restaurant is fetched.
 *
 * The geometry deliberately mirrors `page.tsx` — same brand band, same header
 * padding, same content width, same menu heading position. A skeleton that does
 * not match its final layout trades a blank screen for a layout shift, which is
 * worse: it scores against CLS and looks broken on a phone.
 *
 * Individual skeletons are `aria-hidden`; the wrapper carries `aria-busy` and a
 * single polite status message, so a screen reader hears "Loading restaurant"
 * once instead of announcing a dozen empty boxes.
 */
export default function Loading() {
  return (
    <div className="flex min-h-dvh flex-col bg-background" aria-busy="true">
      <p role="status" className="sr-only">
        Loading restaurant
      </p>

      <header className="border-b border-border bg-card">
        <div aria-hidden="true" className="h-1.5 w-full bg-primary" />
        <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
          <Skeleton className="h-9 w-3/4 sm:h-10" />
          <Skeleton className="mt-4 h-5 w-full max-w-prose" />
          <Skeleton className="mt-2 h-5 w-2/3 max-w-prose" />
          <Skeleton className="mt-5 h-5 w-1/2" />
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 px-5 py-8 sm:px-8 sm:py-12">
        <Skeleton className="h-7 w-24" />

        {/* The section navigation pills. */}
        <div className="mt-4 flex gap-2 overflow-hidden">
          <Skeleton className="h-11 w-24 shrink-0 rounded-full" />
          <Skeleton className="h-11 w-20 shrink-0 rounded-full" />
          <Skeleton className="h-11 w-28 shrink-0 rounded-full" />
        </div>

        {/*
          Two sections of three items. Enough to occupy roughly the space the
          real menu will, without pretending to know how long it is — an
          over-long skeleton produces its own layout shift when the real,
          shorter menu replaces it.
        */}
        <div className="mt-8 flex flex-col gap-10">
          {[0, 1].map((section) => (
            <div key={section}>
              <Skeleton className="h-6 w-32" />
              <div className="mt-4 flex flex-col gap-6">
                {[0, 1, 2].map((row) => (
                  <div key={row}>
                    <div className="flex items-baseline justify-between gap-4">
                      <Skeleton className="h-5 w-40" />
                      <Skeleton className="h-5 w-14 shrink-0" />
                    </div>
                    <Skeleton className="mt-2 h-4 w-3/4" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
