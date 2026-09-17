import Link from "next/link";

/**
 * Shown when the slug does not resolve to a visible restaurant.
 *
 * The API answers 404 both for a restaurant that does not exist and for one
 * that has been deactivated, and that indistinguishability is deliberate on the
 * backend. This copy therefore never claims which case occurred — asserting
 * "this restaurant was removed" would leak exactly the information the API
 * withholds, and would also be wrong half the time.
 *
 * Framed as a dead QR code rather than as customer error: the person scanned a
 * printed code and did nothing wrong.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        This menu isn&apos;t available
      </h1>

      <p className="text-pretty text-base leading-relaxed text-muted-foreground">
        The code you scanned doesn&apos;t lead to an active menu. It may have
        been replaced with a newer one.
      </p>

      <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
        Please ask a member of staff for the current menu.
      </p>

      <Link
        href="/"
        className="mx-auto mt-2 inline-flex h-11 items-center justify-center rounded-md px-5 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Go to the homepage
      </Link>
    </div>
  );
}
