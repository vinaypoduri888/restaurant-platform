import { Hono } from "hono";
import { restaurantScopeParamSchema } from "@repo/validation/category";
import { mediaParamSchema } from "@repo/validation/media";
import { requireAuth } from "../../middleware/auth.ts";
import type { AppEnv } from "../../shared/app-env.ts";
import { validate } from "../../shared/validate.ts";
import * as mediaController from "./media.controller.ts";

/**
 * Administrative media routes, mounted at
 * `/admin/restaurants/:restaurantId/media`.
 *
 * The restaurant is in the path, so the tenant is validated and authorized
 * identically on every route and a body field naming a different restaurant has
 * nowhere to take effect.
 *
 * There is no `PATCH`: media is immutable. Changing a logo means uploading a
 * new one, which replaces the old row and object — modelled by the
 * `(restaurantId, purpose)` unique constraint rather than by an update.
 */
export const adminMediaRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", validate("param", restaurantScopeParamSchema), mediaController.list)
  .post("/", validate("param", restaurantScopeParamSchema), mediaController.upload)
  .delete("/:mediaId", validate("param", mediaParamSchema), mediaController.remove);

/**
 * Public object serving, mounted at `/media`.
 *
 * Only the `local` adapter needs this — with `r2` the public base URL points at
 * Cloudflare and nothing here is ever reached. It is mounted unconditionally
 * anyway: a route that returns 404 for keys no local adapter wrote is harmless,
 * and making the route table depend on configuration would make the running
 * shape of the app harder to reason about.
 *
 * Unauthenticated and read-only by design — branding images are public.
 */
export const publicMediaRoutes = new Hono<AppEnv>().get("/*", mediaController.serve);
