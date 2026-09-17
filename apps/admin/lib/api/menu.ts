import { cache } from "react";
import { apiRequest, type Paginated } from "./client";

/**
 * Menu data as the *admin* API returns it.
 *
 * Two differences from the public shape, both intentional on the backend:
 *
 *   - Hidden content is included. `isActive: false` rows are exactly what an
 *     owner needs to see and edit.
 *   - Price arrives as a bare `priceMinor` integer, with the currency living on
 *     the restaurant record. The public endpoint assembles the two into a money
 *     object; here they stay separate, so every price rendered in this app is
 *     formatted against its restaurant's currency.
 */
export interface AdminCategory {
  id: string;
  restaurantId: string;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * How many menu items this section holds, counted by the database.
   *
   * Previously derived here from a single page of items, which under-counted
   * any restaurant with more items than one page — and made a delete
   * confirmation claim a section was empty when it was not.
   */
  menuItemCount: number;
}

export interface AdminMenuItem {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceMinor: number;
  isAvailable: boolean;
  isActive: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * `description: null` is meaningful, not sloppy typing: the shared validation
 * schema maps an emptied field to `null`, and the API reads that as "clear
 * this value". `undefined` means "leave it unchanged".
 */
export interface CategoryInput {
  name?: string;
  slug?: string;
  description?: string | null;
  position?: number;
  isActive?: boolean;
}

export interface MenuItemInput {
  categoryId?: string;
  name?: string;
  /** `null` clears the description; `undefined` leaves it unchanged. */
  description?: string | null;
  priceMinor?: number;
  isAvailable?: boolean;
  isActive?: boolean;
  position?: number;
}

function categoriesPath(restaurantId: string): string {
  return `/admin/restaurants/${encodeURIComponent(restaurantId)}/categories`;
}

function itemsPath(restaurantId: string): string {
  return `/admin/restaurants/${encodeURIComponent(restaurantId)}/menu-items`;
}

// --- Categories -------------------------------------------------------------

/**
 * Every category, in menu order.
 *
 * `limit=100` matches the backend's own cap of 100 categories per restaurant,
 * so one request always returns the complete list. Paginating a collection that
 * cannot exceed one page would add controls that never do anything.
 */
export const listCategories = cache(
  async (restaurantId: string): Promise<Paginated<AdminCategory>> =>
    apiRequest<Paginated<AdminCategory>>(`${categoriesPath(restaurantId)}?limit=100`),
);

export function createCategory(
  restaurantId: string,
  input: CategoryInput,
): Promise<AdminCategory> {
  return apiRequest<AdminCategory>(categoriesPath(restaurantId), { method: "POST", body: input });
}

export function updateCategory(
  restaurantId: string,
  categoryId: string,
  input: CategoryInput,
): Promise<AdminCategory> {
  return apiRequest<AdminCategory>(
    `${categoriesPath(restaurantId)}/${encodeURIComponent(categoryId)}`,
    { method: "PATCH", body: input },
  );
}

/**
 * Deletes a category.
 *
 * `force` maps to the backend's documented `?force=true`, which deletes the
 * category's menu items along with it. Without it the API refuses with 409
 * while the category still holds items — that refusal is the safety mechanism,
 * and this app surfaces it as an explicit confirmation rather than passing
 * `force` by default.
 */
export function deleteCategory(
  restaurantId: string,
  categoryId: string,
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  const query = force ? "?force=true" : "";
  return apiRequest<void>(
    `${categoriesPath(restaurantId)}/${encodeURIComponent(categoryId)}${query}`,
    { method: "DELETE" },
  );
}

// --- Menu items -------------------------------------------------------------

export interface ListMenuItemsOptions {
  page?: number;
  limit?: number;
  categoryId?: string;
  isActive?: boolean;
  isAvailable?: boolean;
}

/**
 * Menu items, paginated and filterable.
 *
 * Unlike categories, this genuinely can exceed one page: the backend allows up
 * to 200 items per category, so a large restaurant will have more items than a
 * single page holds. The filters map one-to-one onto query parameters the API
 * already supports — none are invented, and none are applied client-side.
 */
export const listMenuItems = cache(
  async (
    restaurantId: string,
    options: ListMenuItemsOptions = {},
  ): Promise<Paginated<AdminMenuItem>> => {
    const query = new URLSearchParams();
    query.set("page", String(options.page ?? 1));
    query.set("limit", String(options.limit ?? 20));
    if (options.categoryId) query.set("categoryId", options.categoryId);
    // The API parses exactly "true"/"false" and rejects anything else, so the
    // literals are written out rather than coerced from a boolean.
    if (options.isActive !== undefined) query.set("isActive", options.isActive ? "true" : "false");
    if (options.isAvailable !== undefined) {
      query.set("isAvailable", options.isAvailable ? "true" : "false");
    }

    return apiRequest<Paginated<AdminMenuItem>>(`${itemsPath(restaurantId)}?${query}`);
  },
);

export function createMenuItem(
  restaurantId: string,
  input: MenuItemInput,
): Promise<AdminMenuItem> {
  return apiRequest<AdminMenuItem>(itemsPath(restaurantId), { method: "POST", body: input });
}

export function updateMenuItem(
  restaurantId: string,
  menuItemId: string,
  input: MenuItemInput,
): Promise<AdminMenuItem> {
  return apiRequest<AdminMenuItem>(
    `${itemsPath(restaurantId)}/${encodeURIComponent(menuItemId)}`,
    { method: "PATCH", body: input },
  );
}

export function deleteMenuItem(restaurantId: string, menuItemId: string): Promise<void> {
  return apiRequest<void>(`${itemsPath(restaurantId)}/${encodeURIComponent(menuItemId)}`, {
    method: "DELETE",
  });
}
