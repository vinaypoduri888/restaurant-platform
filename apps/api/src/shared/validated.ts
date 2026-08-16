import type { Context } from "hono";

/**
 * Hono infers `c.req.valid()`'s target/return types only when the handler is
 * passed inline to the route chain (`.get(path, validator, (c) => ...)`).
 * Once the handler is extracted into a separately-declared controller
 * function, that inference doesn't reach it and `c.req.valid()` types as
 * `never`. This helper is the one place that works around it — callers
 * supply the type the corresponding zValidator schema actually produces.
 */
export function getValidated<T>(c: Context, target: "json" | "param" | "query"): T {
  return (c.req as unknown as { valid: (target: string) => T }).valid(target);
}
