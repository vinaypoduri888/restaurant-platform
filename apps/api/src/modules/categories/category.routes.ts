import { Hono } from "hono";
import {
  categoryParamSchema,
  createCategorySchema,
  deleteCategoryQuerySchema,
  listCategoriesQuerySchema,
  restaurantScopeParamSchema,
  updateCategorySchema,
} from "@repo/validation/category";
import { restaurantSlugParamSchema } from "@repo/validation/restaurant";
import { requireAuth } from "../../middleware/auth.ts";
import type { AppEnv } from "../../shared/app-env.ts";
import { validate } from "../../shared/validate.ts";
import * as categoryController from "./category.controller.ts";

/**
 * Public menu read. Mounted at /restaurants, so the customer-facing URL is
 * `GET /restaurants/:slug/menu` — addressed by slug, like every other public
 * restaurant route, so internal ids never appear in a public URL.
 *
 * It lives in this module rather than in `restaurants` because the response is
 * category-shaped and the query is rooted at Category; the restaurant is
 * resolved by calling the restaurants *service*, which is the only cross-module
 * dependency the architecture permits.
 */
export const publicMenuRoutes = new Hono<AppEnv>().get(
  "/:slug/menu",
  validate("param", restaurantSlugParamSchema),
  categoryController.getPublicMenu,
);

/**
 * Administrative. Mounted at /admin/restaurants/:restaurantId/categories, so
 * the tenant is part of the path and is therefore covered by the same
 * validation and authorization on every single route. A body field claiming a
 * different restaurant has nowhere to take effect.
 */
export const adminCategoryRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get(
    "/",
    validate("param", restaurantScopeParamSchema),
    validate("query", listCategoriesQuerySchema),
    categoryController.list,
  )
  .post(
    "/",
    validate("param", restaurantScopeParamSchema),
    validate("json", createCategorySchema),
    categoryController.create,
  )
  .get("/:categoryId", validate("param", categoryParamSchema), categoryController.getById)
  .patch(
    "/:categoryId",
    validate("param", categoryParamSchema),
    validate("json", updateCategorySchema),
    categoryController.update,
  )
  .delete(
    "/:categoryId",
    validate("param", categoryParamSchema),
    validate("query", deleteCategoryQuerySchema),
    categoryController.remove,
  );
