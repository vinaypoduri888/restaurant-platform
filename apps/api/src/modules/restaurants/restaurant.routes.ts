import { Hono } from "hono";
import {
  replaceOperatingHoursSchema,
  restaurantHoursParamSchema,
} from "@repo/validation/operating-hours";
import {
  createRestaurantSchema,
  listRestaurantsQuerySchema,
  restaurantIdParamSchema,
  restaurantSlugParamSchema,
  updateRestaurantSchema,
} from "@repo/validation/restaurant";
import { requireAuth } from "../../middleware/auth.ts";
import type { AppEnv } from "../../shared/app-env.ts";
import { validate } from "../../shared/validate.ts";
import * as restaurantController from "./restaurant.controller.ts";

/**
 * Public, unauthenticated. Exposes only active restaurants and a reduced field
 * set, addressed by slug rather than internal id. Mounted at /restaurants.
 */
export const publicRestaurantRoutes = new Hono<AppEnv>()
  .get("/", validate("query", listRestaurantsQuerySchema), restaurantController.listPublic)
  .get(
    "/:slug",
    validate("param", restaurantSlugParamSchema),
    restaurantController.getPublicBySlug,
  );

/**
 * Administrative. Every route requires a session and is scoped to the caller's
 * restaurant memberships. Mounted at /admin/restaurants.
 */
export const adminRestaurantRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", validate("query", listRestaurantsQuerySchema), restaurantController.list)
  .get("/:id", validate("param", restaurantIdParamSchema), restaurantController.getById)
  .post("/", validate("json", createRestaurantSchema), restaurantController.create)
  .patch(
    "/:id",
    validate("param", restaurantIdParamSchema),
    validate("json", updateRestaurantSchema),
    restaurantController.update,
  )
  .delete("/:id", validate("param", restaurantIdParamSchema), restaurantController.remove);

/**
 * Operating hours. Mounted at /admin/restaurants/:restaurantId/hours.
 *
 * A separate router only because the path carries a differently-named parameter
 * (`restaurantId` rather than `id`); the module, service, and repository are
 * still the restaurant's own. Hours have no lifecycle apart from a restaurant,
 * so giving them a module of their own would add a boundary with nothing on the
 * other side of it.
 *
 * `PUT` rather than `PATCH`: the request carries the complete week and replaces
 * it. That makes the write idempotent and removes any question about what an
 * omitted day would have meant.
 */
export const adminRestaurantHoursRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", validate("param", restaurantHoursParamSchema), restaurantController.getHours)
  .put(
    "/",
    validate("param", restaurantHoursParamSchema),
    validate("json", replaceOperatingHoursSchema),
    restaurantController.replaceHours,
  );
