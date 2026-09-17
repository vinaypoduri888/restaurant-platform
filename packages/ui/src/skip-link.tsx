import type { AnchorHTMLAttributes } from "react";
import { cn } from "./lib/cn";

export interface SkipLinkProps
  extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Id of the main content element, without the leading `#`. */
  targetId?: string;
}

/**
 * "Skip to main content" — the first focusable element on every page.
 *
 * Keyboard and screen-reader users otherwise have to tab through the entire
 * header on every navigation before reaching the content. WCAG 2.4.1 requires
 * a bypass mechanism; this is the standard one.
 *
 * It is visually hidden until focused, then appears — so it costs sighted
 * users nothing while remaining discoverable to anyone tabbing.
 *
 * The target element must be focusable for the jump to move focus as well as
 * scroll, which means `tabIndex={-1}` on the `<main>` it points at.
 */
export function SkipLink({
  targetId = "main-content",
  className,
  children = "Skip to main content",
  ...props
}: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className={cn(
        "sr-only",
        "focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50",
        "focus:rounded-md focus:bg-primary focus:px-4 focus:py-2",
        "focus:text-sm focus:font-medium focus:text-primary-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}
