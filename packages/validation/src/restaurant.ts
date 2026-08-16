import { z } from "zod";

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug must be lowercase letters, numbers, and hyphens only");

export const createRestaurantSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  // Optional: the service layer generates one from `name` if omitted.
  slug: slug.optional(),
  description: z.string().trim().max(2000).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(500).optional(),
  city: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
});

export const updateRestaurantSchema = createRestaurantSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const restaurantIdParamSchema = z.object({
  id: z.string().trim().min(1, "id is required"),
});

/** Public routes address a restaurant by slug so internal ids stay private. */
export const restaurantSlugParamSchema = z.object({
  slug,
});

/**
 * Query strings carry booleans as text, and `z.coerce.boolean()` cannot be used
 * here: it applies JavaScript `Boolean()` semantics, so every non-empty string —
 * including `"false"` and `"0"` — becomes `true`. Parsing the two accepted
 * literals explicitly makes `?isActive=false` mean what it says, and rejects
 * anything else with a 400 rather than guessing.
 */
const booleanQueryParam = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

export const listRestaurantsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  isActive: booleanQueryParam.optional(),
});

export type CreateRestaurantInput = z.infer<typeof createRestaurantSchema>;
export type UpdateRestaurantInput = z.infer<typeof updateRestaurantSchema>;
export type RestaurantIdParam = z.infer<typeof restaurantIdParamSchema>;
export type RestaurantSlugParam = z.infer<typeof restaurantSlugParamSchema>;
export type ListRestaurantsQuery = z.infer<typeof listRestaurantsQuerySchema>;
