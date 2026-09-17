import { z } from "zod";
import {
  booleanQueryParam,
  optionalText,
  paginationQueryFields,
  positionSchema,
  resourceIdSchema,
  slugSchema,
} from "./common.ts";

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  // Optional: the service derives one from `name` when omitted.
  slug: slugSchema.max(120).optional(),
  description: optionalText(500),
  // Optional: the service appends to the end of the menu when omitted.
  position: positionSchema.optional(),
  isActive: z.boolean().optional(),
});

export const updateCategorySchema = createCategorySchema.partial();

/**
 * The restaurant is always taken from the URL, never from the body — a caller
 * must not be able to redirect a write to another tenant by adding a field.
 */
export const restaurantScopeParamSchema = z.object({
  restaurantId: resourceIdSchema,
});

export const categoryParamSchema = z.object({
  restaurantId: resourceIdSchema,
  categoryId: resourceIdSchema,
});

export const listCategoriesQuerySchema = z.object({
  ...paginationQueryFields,
  isActive: booleanQueryParam.optional(),
});

/**
 * Deleting a category that still holds menu items is refused by default, so a
 * mis-click cannot take a restaurant's whole starters section with it. `force`
 * is the explicit opt-in to delete the items as well.
 */
export const deleteCategoryQuerySchema = z.object({
  force: booleanQueryParam.optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type RestaurantScopeParam = z.infer<typeof restaurantScopeParamSchema>;
export type CategoryParam = z.infer<typeof categoryParamSchema>;
export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;
export type DeleteCategoryQuery = z.infer<typeof deleteCategoryQuerySchema>;
