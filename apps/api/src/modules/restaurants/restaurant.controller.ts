import type { Context } from "hono";
import type {
  ReplaceOperatingHoursInput,
  RestaurantHoursParam,
} from "@repo/validation/operating-hours";
import type {
  CreateRestaurantInput,
  ListRestaurantsQuery,
  RestaurantIdParam,
  RestaurantSlugParam,
  UpdateRestaurantInput,
} from "@repo/validation/restaurant";
import type { AppEnv } from "../../shared/app-env.ts";
import { created, noContent, ok } from "../../shared/http.ts";
import { getValidated } from "../../shared/validated.ts";
import { restaurantService } from "./restaurant.service.ts";

type Ctx = Context<AppEnv>;

// --- Public -----------------------------------------------------------------

export async function listPublic(c: Ctx) {
  const query = getValidated<ListRestaurantsQuery>(c, "query");
  return ok(c, await restaurantService.listPublic(query));
}

export async function getPublicBySlug(c: Ctx) {
  const { slug } = getValidated<RestaurantSlugParam>(c, "param");
  return ok(c, await restaurantService.getPublicBySlug(slug));
}

// --- Admin (requires authentication) ----------------------------------------

export async function list(c: Ctx) {
  const query = getValidated<ListRestaurantsQuery>(c, "query");
  return ok(c, await restaurantService.listForUser(c.get("user").id, query));
}

export async function getById(c: Ctx) {
  const { id } = getValidated<RestaurantIdParam>(c, "param");
  return ok(c, await restaurantService.getForUser(c.get("user").id, id));
}

export async function create(c: Ctx) {
  const input = getValidated<CreateRestaurantInput>(c, "json");
  return created(c, await restaurantService.create(c.get("user").id, input));
}

export async function update(c: Ctx) {
  const { id } = getValidated<RestaurantIdParam>(c, "param");
  const input = getValidated<UpdateRestaurantInput>(c, "json");
  return ok(c, await restaurantService.update(c.get("user").id, id, input));
}

export async function remove(c: Ctx) {
  const { id } = getValidated<RestaurantIdParam>(c, "param");
  await restaurantService.remove(c.get("user").id, id);
  return noContent(c);
}

// --- Operating hours (requires authentication) ------------------------------

export async function getHours(c: Ctx) {
  const { restaurantId } = getValidated<RestaurantHoursParam>(c, "param");
  return ok(c, await restaurantService.getHoursForUser(c.get("user").id, restaurantId));
}

export async function replaceHours(c: Ctx) {
  const { restaurantId } = getValidated<RestaurantHoursParam>(c, "param");
  const input = getValidated<ReplaceOperatingHoursInput>(c, "json");
  return ok(c, await restaurantService.replaceHours(c.get("user").id, restaurantId, input));
}
