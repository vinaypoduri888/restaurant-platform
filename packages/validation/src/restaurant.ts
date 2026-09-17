import { z } from "zod";
import { booleanQueryParam, paginationQueryFields, slugSchema } from "./common.ts";
import { timeZoneSchema } from "./operating-hours.ts";

/**
 * ISO 4217 alphabetic code. The list of real codes changes over time, so the
 * shape is validated rather than an allow-list frozen into the schema; an
 * unknown-but-well-formed code degrades to two decimal places at render time
 * instead of failing the request.
 */
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code, e.g. USD");

export const createRestaurantSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  // Optional: the service layer generates one from `name` if omitted.
  slug: slugSchema.optional(),
  description: z.string().trim().max(2000).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(500).optional(),
  city: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  currency: currencySchema.optional(),
  // The zone the restaurant's operating hours are written in. Defaults to UTC
  // at the database level when omitted; see `operating-hours.ts`.
  timeZone: timeZoneSchema.optional(),
});

export const updateRestaurantSchema = createRestaurantSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const restaurantIdParamSchema = z.object({
  id: z.string().trim().min(1, "id is required"),
});

/** Public routes address a restaurant by slug so internal ids stay private. */
export const restaurantSlugParamSchema = z.object({
  slug: slugSchema,
});

export const listRestaurantsQuerySchema = z.object({
  ...paginationQueryFields,
  isActive: booleanQueryParam.optional(),
});

export type CreateRestaurantInput = z.infer<typeof createRestaurantSchema>;
export type UpdateRestaurantInput = z.infer<typeof updateRestaurantSchema>;
export type RestaurantIdParam = z.infer<typeof restaurantIdParamSchema>;
export type RestaurantSlugParam = z.infer<typeof restaurantSlugParamSchema>;
export type ListRestaurantsQuery = z.infer<typeof listRestaurantsQuerySchema>;
