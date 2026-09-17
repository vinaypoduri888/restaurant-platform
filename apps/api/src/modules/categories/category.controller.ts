import type { Context } from "hono";
import type {
  CategoryParam,
  CreateCategoryInput,
  DeleteCategoryQuery,
  ListCategoriesQuery,
  RestaurantScopeParam,
  UpdateCategoryInput,
} from "@repo/validation/category";
import type { RestaurantSlugParam } from "@repo/validation/restaurant";
import type { AppEnv } from "../../shared/app-env.ts";
import { created, noContent, ok } from "../../shared/http.ts";
import { getValidated } from "../../shared/validated.ts";
import { categoryService } from "./category.service.ts";

type Ctx = Context<AppEnv>;

// --- Public -----------------------------------------------------------------

export async function getPublicMenu(c: Ctx) {
  const { slug } = getValidated<RestaurantSlugParam>(c, "param");
  return ok(c, await categoryService.getPublicMenu(slug));
}

// --- Admin (requires authentication) ----------------------------------------

export async function list(c: Ctx) {
  const { restaurantId } = getValidated<RestaurantScopeParam>(c, "param");
  const query = getValidated<ListCategoriesQuery>(c, "query");
  return ok(c, await categoryService.list(c.get("user").id, restaurantId, query));
}

export async function getById(c: Ctx) {
  const { restaurantId, categoryId } = getValidated<CategoryParam>(c, "param");
  return ok(c, await categoryService.getById(c.get("user").id, restaurantId, categoryId));
}

export async function create(c: Ctx) {
  const { restaurantId } = getValidated<RestaurantScopeParam>(c, "param");
  const input = getValidated<CreateCategoryInput>(c, "json");
  return created(c, await categoryService.create(c.get("user").id, restaurantId, input));
}

export async function update(c: Ctx) {
  const { restaurantId, categoryId } = getValidated<CategoryParam>(c, "param");
  const input = getValidated<UpdateCategoryInput>(c, "json");
  return ok(c, await categoryService.update(c.get("user").id, restaurantId, categoryId, input));
}

export async function remove(c: Ctx) {
  const { restaurantId, categoryId } = getValidated<CategoryParam>(c, "param");
  const { force } = getValidated<DeleteCategoryQuery>(c, "query");

  await categoryService.remove(c.get("user").id, restaurantId, categoryId, force ?? false);
  return noContent(c);
}
