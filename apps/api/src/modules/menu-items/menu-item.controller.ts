import type { Context } from "hono";
import type { RestaurantScopeParam } from "@repo/validation/category";
import type {
  CreateMenuItemInput,
  ListMenuItemsQuery,
  MenuItemParam,
  UpdateMenuItemInput,
} from "@repo/validation/menu-item";
import type { AppEnv } from "../../shared/app-env.ts";
import { created, noContent, ok } from "../../shared/http.ts";
import { getValidated } from "../../shared/validated.ts";
import { menuItemService } from "./menu-item.service.ts";

type Ctx = Context<AppEnv>;

export async function list(c: Ctx) {
  const { restaurantId } = getValidated<RestaurantScopeParam>(c, "param");
  const query = getValidated<ListMenuItemsQuery>(c, "query");
  return ok(c, await menuItemService.list(c.get("user").id, restaurantId, query));
}

export async function getById(c: Ctx) {
  const { restaurantId, menuItemId } = getValidated<MenuItemParam>(c, "param");
  return ok(c, await menuItemService.getById(c.get("user").id, restaurantId, menuItemId));
}

export async function create(c: Ctx) {
  const { restaurantId } = getValidated<RestaurantScopeParam>(c, "param");
  const input = getValidated<CreateMenuItemInput>(c, "json");
  return created(c, await menuItemService.create(c.get("user").id, restaurantId, input));
}

export async function update(c: Ctx) {
  const { restaurantId, menuItemId } = getValidated<MenuItemParam>(c, "param");
  const input = getValidated<UpdateMenuItemInput>(c, "json");
  return ok(c, await menuItemService.update(c.get("user").id, restaurantId, menuItemId, input));
}

export async function remove(c: Ctx) {
  const { restaurantId, menuItemId } = getValidated<MenuItemParam>(c, "param");
  await menuItemService.remove(c.get("user").id, restaurantId, menuItemId);
  return noContent(c);
}
