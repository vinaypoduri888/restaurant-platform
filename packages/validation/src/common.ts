import { z } from "zod";

/**
 * Primitives shared by more than one resource schema.
 *
 * These live here rather than being repeated per file so that "what a slug is"
 * or "how a boolean arrives in a query string" has exactly one definition —
 * and so the OpenAPI document, which is generated from these same schemas,
 * cannot describe two different rules for the same concept.
 */

/** URL-safe identifier: lowercase alphanumerics separated by single hyphens. */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug must be lowercase letters, numbers, and hyphens only");

/**
 * Query strings carry booleans as text, and `z.coerce.boolean()` cannot be used
 * here: it applies JavaScript `Boolean()` semantics, so every non-empty string —
 * including `"false"` and `"0"` — becomes `true`. Parsing the two accepted
 * literals explicitly makes `?isActive=false` mean what it says, and rejects
 * anything else with a 400 rather than guessing.
 */
export const booleanQueryParam = z.enum(["true", "false"]).transform((value) => value === "true");

/**
 * A resource identifier read from a URL path.
 *
 * Deliberately not a `cuid()` check. Authorization runs before any lookup, so a
 * syntactically perfect id for someone else's restaurant and a malformed one
 * must be indistinguishable in the response; validating the shape here would
 * split them into 400 and 403. The bounds exist only to stop an unbounded
 * string reaching the database.
 */
export const resourceIdSchema = z.string().trim().min(1, "id is required").max(64);

/**
 * Display order within a menu. Non-negative and bounded; gaps are expected and
 * fine, since ordering is by value rather than by contiguous rank.
 */
export const positionSchema = z.number().int().min(0).max(1_000_000);

/**
 * Pagination shared by every admin list endpoint. Spread into a `z.object`
 * rather than merged, so each schema stays a plain object for JSON Schema
 * generation.
 */
export const paginationQueryFields = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

/**
 * Free text that the caller may also clear.
 *
 * Trimming leaves whitespace-only input as `""`, which would otherwise be
 * stored as a second kind of empty alongside `NULL`. Mapping it to `null`
 * gives one representation for "no description", while omitting the field
 * entirely still means "leave unchanged".
 */
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .optional();
}
