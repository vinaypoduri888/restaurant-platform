import type { Context } from "hono";
import type { RestaurantScopeParam } from "@repo/validation/category";
import { uploadMediaSchema, type MediaParam } from "@repo/validation/media";
import type { AppEnv } from "../../shared/app-env.ts";
import { BadRequestError, NotFoundError } from "../../shared/errors.ts";
import { created, noContent, ok } from "../../shared/http.ts";
import { isSafeMediaKey } from "../../shared/storage/storage.ts";
import { getValidated } from "../../shared/validated.ts";
import { mediaService } from "./media.service.ts";

type Ctx = Context<AppEnv>;

export async function list(c: Ctx) {
  const { restaurantId } = getValidated<RestaurantScopeParam>(c, "param");
  const rows = await mediaService.listForUser(c.get("user").id, restaurantId);
  return ok(c, { items: rows.map((row) => mediaService.toAdminView(row)) });
}

/**
 * Multipart upload.
 *
 * The body is parsed here rather than by a `validate("json", …)` middleware
 * because it is `multipart/form-data`, not JSON — a Zod schema has nothing
 * useful to say about a binary blob. The *fields* alongside the file are still
 * validated with the shared schema, so `purpose` is checked by the same object
 * the OpenAPI document is generated from.
 */
export async function upload(c: Ctx) {
  const { restaurantId } = getValidated<RestaurantScopeParam>(c, "param");

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    // A malformed or non-multipart body is the caller's mistake, not a 500.
    throw new BadRequestError("Expected a multipart/form-data upload");
  }

  const parsed = uploadMediaSchema.safeParse({ purpose: form.get("purpose") });
  if (!parsed.success) {
    throw new BadRequestError(
      'Provide "purpose" as either LOGO or BANNER',
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new BadRequestError('Attach the image as a "file" field');
  }

  const media = await mediaService.upload(c.get("user").id, restaurantId, parsed.data.purpose, {
    bytes: new Uint8Array(await file.arrayBuffer()),
    // Recorded so an owner recognises their own file. Never used as a path —
    // the storage key is generated from ids the server controls.
    originalName: sanitiseDisplayName(file.name),
  });

  return created(c, media);
}

export async function remove(c: Ctx) {
  const { restaurantId, mediaId } = getValidated<MediaParam>(c, "param");
  await mediaService.remove(c.get("user").id, restaurantId, mediaId);
  return noContent(c);
}

/**
 * Serves a stored object.
 *
 * Needed only by the `local` adapter, which has no CDN in front of it — with
 * `r2` the public base URL points at Cloudflare and this route is never hit.
 * It is public and read-only: branding images are public by nature.
 *
 * The key is rebuilt from the wildcard path and checked against the exact shape
 * this application generates. Nothing is sanitised: an unexpected key is
 * refused, which cannot be defeated by encoding tricks the way a filter can.
 */
export async function serve(c: Ctx) {
  const key = c.req.path.replace(/^\/media\//, "");

  if (!isSafeMediaKey(key)) {
    // 404 rather than 400: a traversal attempt learns nothing about whether the
    // path shape was the problem or the object simply is not there.
    throw new NotFoundError("Media not found");
  }

  const object = await mediaService.readPublicObject(key);
  if (!object) {
    throw new NotFoundError("Media not found");
  }

  // A plain Response rather than `c.body`: the bytes are a `Uint8Array`, which
  // is already a valid `BodyInit`, so no cast is needed.
  return new Response(object.bytes, {
    status: 200,
    headers: {
      "Content-Type": object.mimeType,
      // Keys are immutable — a replacement gets a new media id and therefore a
      // new key — so the bytes at a given key can be cached indefinitely.
      "Cache-Control": "public, max-age=31536000, immutable",
      // Belt and braces: never let a browser reinterpret these bytes as
      // something executable, whatever the declared type.
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Reduces a client filename to something safe to store and display.
 *
 * This value is *only* ever shown back to the owner; it never touches a path.
 * It is still bounded and stripped of control and separator characters,
 * because unbounded attacker-controlled text in a database column is its own
 * problem.
 *
 * The parameter is optional because a filename genuinely can be absent: a
 * zero-byte multipart part round-trips with no `name`, which previously threw
 * here and turned a 400 into a 500. A filename is untrusted input, so treating
 * its absence as normal is the correct posture rather than a patch.
 */
function sanitiseDisplayName(name: string | undefined): string {
  const cleaned = [...(name ?? "")]
    // Control characters, including NUL, which can truncate a string inside a
    // consumer written in C. Filtered by code point rather than by a regex
    // literal so the intent is unmistakable at a glance.
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    // Path separators, so this value can never be mistaken for a path even if
    // some future code is careless with it.
    .replaceAll("/", "_")
    .replaceAll("\\", "_")
    .trim()
    .slice(0, 255);

  return cleaned.length > 0 ? cleaned : "upload";
}
