import type { HTMLAttributes } from "react";
import { cn } from "./lib/cn";

/**
 * Card is a presentational container only — it renders a plain `<div>` and
 * applies no landmark or heading semantics of its own. Consumers supply the
 * correct element for their context (`<article>`, `<li>`, a heading level),
 * because only the consumer knows where the card sits in the document outline.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-1.5 p-4 sm:p-6", className)} {...props} />
  );
}

export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  /**
   * Heading level. Defaults to `h3`; override so the card sits correctly in
   * the page's heading order rather than skipping levels.
   */
  as?: "h2" | "h3" | "h4";
}

export function CardTitle({ className, as: Tag = "h3", ...props }: CardTitleProps) {
  return (
    <Tag
      className={cn("text-lg font-semibold leading-tight", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}

export function CardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 pt-0 sm:p-6 sm:pt-0", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center gap-2 p-4 pt-0 sm:p-6 sm:pt-0", className)}
      {...props}
    />
  );
}
