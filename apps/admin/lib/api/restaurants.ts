import { cache } from "react";
import type { DayHours } from "@repo/ui/lib/opening-hours";
import { apiRequest, type Paginated } from "./client";

/**
 * The admin restaurant shape, mirroring `GET /admin/restaurants`.
 *
 * Unlike the public projection this includes `isActive` and the timestamps —
 * an owner needs to see the record as it actually is, including content they
 * have hidden from customers.
 *
 */
export interface AdminRestaurant {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  currency: string;
  /** IANA zone the operating hours are expressed in, e.g. `Asia/Kolkata`. */
  timeZone: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RestaurantInput {
  name?: string;
  slug?: string;
  description?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  currency?: string;
  timeZone?: string;
  isActive?: boolean;
}

/** Restaurants the signed-in user is a member of. */
export const listRestaurants = cache(
  async (): Promise<Paginated<AdminRestaurant>> =>
    apiRequest<Paginated<AdminRestaurant>>("/admin/restaurants?limit=100"),
);

/**
 * The caller's own role in one restaurant, from their membership record.
 *
 * Mirrors the `RestaurantRole` enum in the database. It is informational: it
 * decides which controls to *show*, never what is allowed. The API
 * re-authorizes every write regardless.
 */
export type MembershipRole = "OWNER" | "STAFF";

export interface RestaurantWithRole {
  restaurant: AdminRestaurant;
  role: MembershipRole;
}

/**
 * One restaurant, plus the caller's role in it.
 *
 * A caller who is not a member gets 403 — the same answer as for an id that
 * does not exist, deliberately, so the API cannot be used to discover which
 * restaurant ids are real. No role is returned in that case, because there
 * isn't one.
 */
export const getRestaurant = cache(
  async (restaurantId: string): Promise<RestaurantWithRole> =>
    apiRequest<RestaurantWithRole>(`/admin/restaurants/${encodeURIComponent(restaurantId)}`),
);

/**
 * Whether a role may delete menu content.
 *
 * The single place this app maps a role to what it can do, mirroring the
 * backend's capability table (`menu:delete` and `restaurant:delete` are OWNER
 * only). Duplicating that decision per component is how the two drift apart.
 *
 * **Not a security control.** It hides controls that would fail; it does not
 * prevent anything. The backend is the only authority.
 */
export function canDelete(role: MembershipRole): boolean {
  return role === "OWNER";
}

export function createRestaurant(input: RestaurantInput): Promise<AdminRestaurant> {
  return apiRequest<AdminRestaurant>("/admin/restaurants", { method: "POST", body: input });
}

/**
 * The restaurant's week of operating hours.
 *
 * Always seven days in reading order — the API pads days that have never been
 * configured as closed, so the editor renders a row per day without inventing
 * the missing ones.
 */
export const getOperatingHours = cache(
  async (restaurantId: string): Promise<{ days: DayHours[] }> =>
    apiRequest<{ days: DayHours[] }>(
      `/admin/restaurants/${encodeURIComponent(restaurantId)}/hours`,
    ),
);

export interface DayHoursInput {
  dayOfWeek: DayHours["dayOfWeek"];
  isClosed: boolean;
  opensAt?: number | null;
  closesAt?: number | null;
}

/**
 * Replaces the whole week.
 *
 * `PUT`, matching the API: the payload carries all seven days and replaces the
 * schedule outright, so the write is idempotent and no day can be left in an
 * undefined state.
 */
export function replaceOperatingHours(
  restaurantId: string,
  days: DayHoursInput[],
): Promise<{ days: DayHours[] }> {
  return apiRequest<{ days: DayHours[] }>(
    `/admin/restaurants/${encodeURIComponent(restaurantId)}/hours`,
    { method: "PUT", body: { days } },
  );
}

export function updateRestaurant(
  restaurantId: string,
  input: RestaurantInput,
): Promise<AdminRestaurant> {
  return apiRequest<AdminRestaurant>(`/admin/restaurants/${encodeURIComponent(restaurantId)}`, {
    method: "PATCH",
    body: input,
  });
}
