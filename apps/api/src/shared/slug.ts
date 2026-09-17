import { BadRequestError } from "./errors.ts";

/** Reduces free text to the slug alphabet: lowercase alphanumerics and hyphens. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Derives a slug from a display name, refusing to invent one when the name has
 * no slug-able characters at all.
 *
 * Without this guard a name such as "!!!" or a purely non-Latin name slugifies
 * to the empty string, which then either violates the column's constraints or —
 * worse — succeeds and produces a record whose public URL cannot be addressed.
 * Asking the caller for an explicit slug is the only honest outcome.
 */
export function deriveSlug(name: string): string {
  const slug = slugify(name);

  if (slug.length === 0) {
    throw new BadRequestError(
      'A slug could not be derived from this name. Provide "slug" explicitly.',
    );
  }

  return slug;
}
