import { Hono } from "hono";
import { restaurantScopeParamSchema } from "@repo/validation/category";
import {
  createMenuItemSchema,
  listMenuItemsQuerySchema,
  menuItemParamSchema,
  updateMenuItemSchema,
} from "@repo/validation/menu-item";
import { requireAuth } from "../../middleware/auth.ts";
import type { AppEnv } from "../../shared/app-env.ts";
import { validate } from "../../shared/validate.ts";
import * as menuItemController from "./menu-item.controller.ts";

/**
 * Mounted at /admin/restaurants/:restaurantId/menu-items — nested under the
 * restaurant, not under the category.
 *
 * An item's category is mutable: moving a dish from "Mains" to "Specials" is
 * ordinary menu work. Nesting under the category would change the item's URL
 * every time it moved, and would make "every item in this restaurant" an
 * awkward query across sibling collections. The category therefore travels in
 * the payload, while the tenant — which never changes — stays in the path.
 */
export const adminMenuItemRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get(
    "/",
    validate("param", restaurantScopeParamSchema),
    validate("query", listMenuItemsQuerySchema),
    menuItemController.list,
  )
  .post(
    "/",
    validate("param", restaurantScopeParamSchema),
    validate("json", createMenuItemSchema),
    menuItemController.create,
  )
  .get("/:menuItemId", validate("param", menuItemParamSchema), menuItemController.getById)
  .patch(
    "/:menuItemId",
    validate("param", menuItemParamSchema),
    validate("json", updateMenuItemSchema),
    menuItemController.update,
  )
  .delete("/:menuItemId", validate("param", menuItemParamSchema), menuItemController.remove);
