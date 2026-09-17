import type { HTMLAttributes } from "react";
import { cn } from "./lib/cn";

/**
 * Hides content visually while keeping it available to screen readers.
 *
 * Use for text that provides context a sighted user gets from layout or an
 * icon — "Delete <VisuallyHidden>Pizza Palace</VisuallyHidden>" turns a row of
 * identical "Delete" buttons into distinguishable ones when read out of
 * context.
 *
 * This is NOT `display: none` or `visibility: hidden`; both remove the element
 * from the accessibility tree entirely, which defeats the purpose. It relies on
 * Tailwind's `sr-only`, which is the clip-rect technique.
 */
export function VisuallyHidden({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("sr-only", className)} {...props} />;
}
