import { Prisma, type Prisma as PrismaTypes } from "@repo/database";
import type {
  CreateMenuItemInput,
  ListMenuItemsQuery,
  UpdateMenuItemInput,
} from "@repo/validation/menu-item";
import { ConflictError, NotFoundError } from "../../shared/errors.ts";
import { membershipService } from "../auth/membership.service.ts";
import { categoryRepository } from "../categories/category.repository.ts";
import { menuItemRepository } from "./menu-item.repository.ts";

/**
 * A guardrail, not a product limit — see the equivalent note in
 * `category.service.ts`. Together the two caps are what make the unpaginated
 * public menu a bounded response.
 */
const MAX_ITEMS_PER_CATEGORY = 200;

function paginate(query: ListMenuItemsQuery) {
  return { skip: (query.page - 1) * query.limit, take: query.limit };
}

function asNotFound(error: unknown, menuItemId: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    throw new NotFoundError(`Menu item "${menuItemId}" not found`);
  }
  throw error;
}

/**
 * Resolves the target category *within the caller's restaurant*.
 *
 * This is the check that stops an item being filed under another restaurant's
 * category. The database enforces the same rule through the composite foreign
 * key, so this exists to produce a clear 404 rather than a constraint error —
 * the guarantee itself does not depend on it.
 */
async function assertCategoryInRestaurant(restaurantId: string, categoryId: string) {
  const category = await categoryRepository.findScoped(restaurantId, categoryId);
  if (!category) {
    throw new NotFoundError(`Category "${categoryId}" not found`);
  }
}

async function assertCategoryHasRoom(restaurantId: string, categoryId: string) {
  const existing = await menuItemRepository.countInCategory(restaurantId, categoryId);
  if (existing >= MAX_ITEMS_PER_CATEGORY) {
    throw new ConflictError(`A category may have at most ${MAX_ITEMS_PER_CATEGORY} menu items`);
  }
}

/** Appends to the end of its category when the caller did not choose a position. */
async function nextPosition(restaurantId: string, categoryId: string): Promise<number> {
  const max = await menuItemRepository.maxPosition(restaurantId, categoryId);
  return max === null ? 0 : max + 1;
}

export const menuItemService = {
  async list(userId: string, restaurantId: string, query: ListMenuItemsQuery) {
    await membershipService.authorize(userId, restaurantId, "menu:read");

    const where: PrismaTypes.MenuItemWhereInput = {
      ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.isAvailable === undefined ? {} : { isAvailable: query.isAvailable }),
    };
    const { skip, take } = paginate(query);

    const [items, total] = await Promise.all([
      menuItemRepository.findMany({ restaurantId, skip, take, where }),
      menuItemRepository.count(restaurantId, where),
    ]);

    return { items, total, page: query.page, limit: query.limit };
  },

  async getById(userId: string, restaurantId: string, menuItemId: string) {
    await membershipService.authorize(userId, restaurantId, "menu:read");

    const item = await menuItemRepository.findScoped(restaurantId, menuItemId);
    if (!item) {
      throw new NotFoundError(`Menu item "${menuItemId}" not found`);
    }
    return item;
  },

  async create(userId: string, restaurantId: string, input: CreateMenuItemInput) {
    await membershipService.authorize(userId, restaurantId, "menu:write");
    await assertCategoryInRestaurant(restaurantId, input.categoryId);
    await assertCategoryHasRoom(restaurantId, input.categoryId);

    return menuItemRepository.create({
      ...input,
      // From the authorized URL scope, never from the body.
      restaurantId,
      position: input.position ?? (await nextPosition(restaurantId, input.categoryId)),
    });
  },

  async update(
    userId: string,
    restaurantId: string,
    menuItemId: string,
    input: UpdateMenuItemInput,
  ) {
    await membershipService.authorize(userId, restaurantId, "menu:write");

    const existing = await menuItemRepository.findScoped(restaurantId, menuItemId);
    if (!existing) {
      throw new NotFoundError(`Menu item "${menuItemId}" not found`);
    }

    // Moving an item to another section is a category change, and the target
    // must belong to the same restaurant.
    if (input.categoryId !== undefined && input.categoryId !== existing.categoryId) {
      await assertCategoryInRestaurant(restaurantId, input.categoryId);
      await assertCategoryHasRoom(restaurantId, input.categoryId);
    }

    try {
      return await menuItemRepository.update(restaurantId, menuItemId, input);
    } catch (error) {
      asNotFound(error, menuItemId);
    }
  },

  async remove(userId: string, restaurantId: string, menuItemId: string) {
    await membershipService.authorize(userId, restaurantId, "menu:delete");

    try {
      await menuItemRepository.delete(restaurantId, menuItemId);
    } catch (error) {
      asNotFound(error, menuItemId);
    }
  },
};
