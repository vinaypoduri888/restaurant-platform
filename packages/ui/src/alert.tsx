import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "./lib/cn";

export const alertVariants = cva("rounded-lg border p-4 text-sm", {
  variants: {
    variant: {
      info: "border-border bg-card text-card-foreground",
      success: "border-success/40 bg-success/10 text-foreground",
      warning: "border-warning/40 bg-warning/10 text-foreground",
      destructive: "border-destructive/40 bg-destructive/10 text-foreground",
    },
  },
  defaultVariants: { variant: "info" },
});

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

/**
 * Inline message block for error, empty, and confirmation states.
 *
 * Errors and warnings use `role="alert"`, which is an assertive live region:
 * a screen reader interrupts to announce it. Informational and success
 * messages use `role="status"` (polite), so they are announced without cutting
 * across whatever the user is currently doing.
 *
 * Text colour stays `--foreground` rather than the semantic colour, with the
 * hue carried by a tinted background and border. Coloured body text on a
 * tinted background is the usual way these components fail AA contrast.
 */
export function Alert({ className, variant, ...props }: AlertProps) {
  const assertive = variant === "destructive" || variant === "warning";

  return (
    <div
      role={assertive ? "alert" : "status"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export function AlertTitle({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("font-medium", className)} {...props} />;
}

export function AlertDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("mt-1 text-muted-foreground", className)} {...props} />
  );
}
