import type { HTMLAttributes } from "react";
import { cn } from "./lib/cn";

/**
 * Loading placeholder.
 *
 * `aria-hidden` is intentional: a skeleton is a visual affordance with no
 * information in it, and announcing a row of empty boxes is pure noise. The
 * surrounding region should own the announcement (for example an
 * `aria-busy="true"` container, or a live region that reports when content has
 * arrived).
 *
 * Skeletons must be sized to match the content they stand in for — that is the
 * whole point. A skeleton of the wrong size trades a blank screen for a layout
 * shift, which scores worse on CLS than showing nothing.
 */
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
