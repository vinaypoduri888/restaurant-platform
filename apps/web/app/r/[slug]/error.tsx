"use client";

import { useEffect } from "react";

/**
 * Recovery boundary for genuine failures — the API being down, a timeout, a
 * malformed response.
 *
 * This is one of the very few Client Components in the public app; an error
 * boundary has to be one because it needs `reset`.
 *
 * Nothing about the failure is shown to the customer. The `error` object can
 * carry a stack trace, an internal URL, or a database message, so it is logged
 * and never rendered. Next.js already strips these in production builds, but
 * relying on that alone would make the safety of this page a build-mode detail
 * rather than a property of the code.
 *
 * `digest` is the one identifier worth surfacing: it is a server-generated hash
 * with no internal content, and it lets support correlate a customer report to
 * a server log line.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[restaurant-page] render failed", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        We can&apos;t load this menu right now
      </h1>

      <p className="text-pretty text-base leading-relaxed text-muted-foreground">
        Something went wrong on our side. Please try again in a moment.
      </p>

      <button
        type="button"
        onClick={reset}
        className="mx-auto mt-2 inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Try again
      </button>

      {error.digest ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Reference: <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
    </div>
  );
}
