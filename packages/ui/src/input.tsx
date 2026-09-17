import type { InputHTMLAttributes } from "react";
import { cn } from "./lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Marks the field invalid and wires up `aria-invalid` for assistive tech. */
  invalid?: boolean;
}

/**
 * Text input primitive.
 *
 * `text-base` (16px) is deliberate rather than aesthetic: iOS Safari zooms the
 * viewport when focusing an input with a font size below 16px, which on a phone
 * looks like the page jumping. Height matches the default Button so the two
 * line up when placed side by side.
 */
export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2",
        "text-base text-foreground",
        "placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive",
        className,
      )}
      {...props}
    />
  );
}
