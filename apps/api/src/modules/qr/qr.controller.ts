import type { Context } from "hono";
import type { RestaurantScopeParam } from "@repo/validation/category";
import type { AppEnv } from "../../shared/app-env.ts";
import { ok } from "../../shared/http.ts";
import { getValidated } from "../../shared/validated.ts";
import { qrService } from "./qr.service.ts";

type Ctx = Context<AppEnv>;

/** The QR code and the URL it encodes, for display in the console. */
export async function get(c: Ctx) {
  const { restaurantId } = getValidated<RestaurantScopeParam>(c, "param");
  const qr = await qrService.getForUser(c.get("user").id, restaurantId);

  return ok(c, qr);
}

/**
 * The same code as a downloadable file.
 *
 * A separate route rather than a flag on the one above: a download needs a
 * different `Content-Type` and a `Content-Disposition`, and a JSON endpoint
 * that sometimes returns an image is harder to describe in OpenAPI than two
 * honest endpoints.
 */
export async function download(c: Ctx) {
  const { restaurantId } = getValidated<RestaurantScopeParam>(c, "param");
  const qr = await qrService.getForUser(c.get("user").id, restaurantId);

  return new Response(qr.svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // `attachment` so a browser saves rather than renders it. The filename is
      // built from the slug, which the database constrains to lowercase
      // letters, digits and hyphens — so it cannot break out of the quoted
      // header value or suggest a path.
      "Content-Disposition": `attachment; filename="${qr.fileName}"`,
      // The code changes when the slug changes, and the slug can change at any
      // time, so this must never be cached. A stale download is a printed sheet
      // of codes pointing at an old URL — which still works, thanks to slug
      // history, but is not what the owner asked for.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
