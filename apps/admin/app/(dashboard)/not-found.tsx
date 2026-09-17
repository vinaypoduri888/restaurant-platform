import Link from "next/link";

/**
 * Shown when something inside the dashboard is not reachable by the signed-in
 * user — today, always a restaurant.
 *
 * It lives here rather than beside the restaurant layout because that layout is
 * what calls `notFound()`: a boundary nested *inside* the failing layout cannot
 * render, so it would silently fall through to Next's default 404. Verified —
 * that is exactly what happened before this file moved up a level.
 *
 * The wording deliberately does not say whether the restaurant exists. The API
 * returns the same `403` for "you are not a member" and "no such id" so that a
 * signed-in user cannot use it to discover which ids are real — copy that said
 * "you don't have access to *this restaurant*" would confirm existence and undo
 * that on the frontend.
 *
 * It still names the useful next step, because "ask its owner to add you" is
 * what actually resolves the common case.
 */
export default function RestaurantNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 px-5 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">This restaurant isn&apos;t available</h1>

      <p className="max-w-prose text-pretty text-muted-foreground">
        It may not exist, or your account may not have access to it. If you
        should have access, ask its owner to add you.
      </p>

      <Link
        href="/"
        className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Your restaurants
      </Link>
    </div>
  );
}
