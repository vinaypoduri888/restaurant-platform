"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@repo/ui/button";

/**
 * Error boundary for one restaurant's pages.
 *
 * Separate from the dashboard-wide boundary because the most likely failure
 * here is a `403` — the caller is not a member of this restaurant — and the
 * useful next step is "go back to your restaurants", not "try again".
 *
 * The copy must not imply the restaurant exists. The API deliberately returns
 * the same `403` for "not a member" and "no such id", so that a signed-in user
 * cannot probe for valid restaurant ids; wording that confirmed existence would
 * undo that on the frontend.
 */
export default function RestaurantError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] restaurant page error", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 px-5 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">This restaurant isn&apos;t available</h1>

      <p className="max-w-prose text-pretty text-muted-foreground">
        You may not have access to it, or it may no longer exist. If you think
        you should have access, ask its owner to add you.
      </p>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Your restaurants
        </Link>
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
      </div>

      {error.digest ? (
        <p className="text-sm text-muted-foreground">
          Reference: <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
    </div>
  );
}
