"use client";

import { useEffect } from "react";
import { Button } from "@repo/ui/button";

/**
 * Error boundary for every authenticated page.
 *
 * Renders only safe copy plus the `digest` — an opaque id Next generates and
 * writes to the server log. Nothing from the error itself reaches the screen:
 * a stack trace, a database message, or an internal path would all be leaks,
 * and in development the raw message is right there in the error object.
 *
 * The digest is shown because it is the one thing that makes a support request
 * traceable. It identifies a log line and reveals nothing on its own.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] page error", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 px-5 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>

      <p className="max-w-prose text-pretty text-muted-foreground">
        We couldn&apos;t load this page. This is usually temporary — trying again
        often works. If it keeps happening, the reference below will help us find
        what went wrong.
      </p>

      <Button onClick={reset}>Try again</Button>

      {error.digest ? (
        <p className="text-sm text-muted-foreground">
          Reference: <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
    </div>
  );
}
