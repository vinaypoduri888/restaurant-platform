import { z } from "zod";
import {
  booleanQueryParam,
  optionalText,
  paginationQueryFields,
  positionSchema,
  resourceIdSchema,
} from "./common.ts";

/**
 * Price in the currency's minor unit (cents, paise) as a whole number.
 *
 * Rejecting non-integers here is the point: `12.5` is ambiguous — 12 cents and
 * a half, or 12.50 in major units? — and accepting it would let rounding decide
 * what a customer is charged. Callers must send `1250`, not `12.50`.
 *
 * The upper bound is a sanity guard against a mis-keyed price, not a product
 * limit; it is well inside PostgreSQL's 32-bit integer range.
 */
const priceMinorSchema = z
  .number()
  .int("Price must be a whole number of minor units (e.g. 1250 for 12.50)")
  .min(0)
  .max(99_999_999);

export const createMenuItemSchema = z.object({
  // The category is part of the payload rather than the URL because an item
  // can be moved between sections; see the routes file.
  categoryId: resourceIdSchema,
  name: z.string().trim().min(1, "Name is required").max(180),
  description: optionalText(1000),
  priceMinor: priceMinorSchema,
  isAvailable: z.boolean().optional(),
  isActive: z.boolean().optional(),
  position: positionSchema.optional(),
});

export const updateMenuItemSchema = createMenuItemSchema.partial();

export const menuItemParamSchema = z.object({
  restaurantId: resourceIdSchema,
  menuItemId: resourceIdSchema,
});

export const listMenuItemsQuerySchema = z.object({
  ...paginationQueryFields,
  categoryId: resourceIdSchema.optional(),
  isActive: booleanQueryParam.optional(),
  isAvailable: booleanQueryParam.optional(),
});

export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;
export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>;
export type MenuItemParam = z.infer<typeof menuItemParamSchema>;
export type ListMenuItemsQuery = z.infer<typeof listMenuItemsQuerySchema>;
