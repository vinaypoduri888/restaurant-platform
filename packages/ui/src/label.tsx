import type { LabelHTMLAttributes } from "react";
import { cn } from "./lib/cn";

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  /** Renders a visible required marker that is also announced to screen readers. */
  required?: boolean;
}

/**
 * A real `<label>`, always. Placeholder-as-label is not an accessible
 * substitute: the placeholder disappears on input, is invisible to some
 * assistive tech, and typically fails contrast requirements.
 */
export function Label({ className, required, children, ...props }: LabelProps) {
  return (
    <label
      className={cn(
        "text-sm font-medium text-foreground",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    >
      {children}
      {required ? (
        <>
          {/* aria-hidden on the glyph, real words for screen readers. */}
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
          <span className="sr-only"> (required)</span>
        </>
      ) : null}
    </label>
  );
}
