import type { Context } from "hono";

export function ok<T>(c: Context, data: T) {
  return c.json({ success: true as const, data }, 200);
}

export function created<T>(c: Context, data: T) {
  return c.json({ success: true as const, data }, 201);
}

export function noContent(c: Context) {
  return c.body(null, 204);
}
