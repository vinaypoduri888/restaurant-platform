import { Hono } from "hono";
import { restaurantScopeParamSchema } from "@repo/validation/category";
import { requireAuth } from "../../middleware/auth.ts";
import type { AppEnv } from "../../shared/app-env.ts";
import { validate } from "../../shared/validate.ts";
import * as qrController from "./qr.controller.ts";

/**
 * QR routes, mounted at `/admin/restaurants/:restaurantId/qr`.
 *
 * Administrative and read-only. The restaurant is in the path, so the tenant is
 * validated and authorized identically on both routes, and there is no body
 * through which a caller could name a different restaurant or a different URL
 * to encode.
 *
 * There is no public QR endpoint. A customer never needs one — they already
 * have the code in their hand — and exposing one would let anyone mint a QR
 * image for any restaurant on this platform's domain.
 */
export const adminQrRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", validate("param", restaurantScopeParamSchema), qrController.get)
  .get("/download", validate("param", restaurantScopeParamSchema), qrController.download);
