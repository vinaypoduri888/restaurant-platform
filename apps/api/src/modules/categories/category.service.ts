import { Prisma, type Prisma as PrismaTypes } from "@repo/database";
import type {
  CreateCategoryInput,
  ListCategoriesQuery,
  UpdateCategoryInput,
} from "@repo/validation/category";
import { ConflictError, NotFoundError } from "../../shared/errors.ts";
import { toMoney } from "../../shared/money.ts";
import { deriveSlug } from "../../shared/slug.ts";
import { membershipService } from "../auth/membership.service.ts";
import { restaurantService } from "../restaurants/restaurant.service.ts";
import { categoryRepository, type PublicMenuCategory } from "./category.repository.ts";

/**
 * A guardrail, not a product limit.
 *
 * The public menu is deliberately returned as one unpaginated document (see
 * `getPublicMenu`), which is only safe if the document cannot grow without
 * bound. Capping at write time keeps every read bounded by construction, and
 * a menu approaching this many sections is a data-entry error rather than a
 * restaurant.
 */
const MAX_CATEGORIES_PER_RESTAURANT = 100;

function paginate(query: ListCategoriesQuery) {
  return { skip: (query.page - 1) * query.limit, take: query.limit };
}

/**
 * The service checks slug availability before writing, but that check and the
 * write are not atomic. The `(restaurant_id, slug)` unique index is the real
 * guarantee; this maps its violation back to a clean 409 instead of a 500.
 */
function asSlugConflict(error: unknown, slug: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ConflictError(`Category slug "${slug}" is already in use in this restaurant`);
  }
  throw error;
}

/** Prisma reports "no row matched the where clause" as P2025. */
function asNotFound(error: unknown, categoryId: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    throw new NotFoundError(`Category "${categoryId}" not found`);
  }
  throw error;
}

async function assertSlugAvailable(restaurantId: string, slug: string, excludeId?: string) {
  const existing = await categoryRepository.findBySlug(restaurantId, slug);
  if (existing && existing.id !== excludeId) {
    throw new ConflictError(`Category slug "${slug}" is already in use in this restaurant`);
  }
}

/** Appends to the end of the menu when the caller did not choose a position. */
async function nextPosition(restaurantId: string): Promise<number> {
  const max = await categoryRepository.maxPosition(restaurantId);
  return max === null ? 0 : max + 1;
}

export const categoryService = {
  // -------------------------------------------------------------------------
  // Public surface — unauthenticated, published content only.
  // -------------------------------------------------------------------------

  /**
   * The whole published menu for a restaurant addressed by slug.
   *
   * Resolving the restaurant through `restaurantService` rather than querying
   * for it here keeps one definition of "a restaurant a customer may see":
   * inactive and non-existent restaurants both 404, and this endpoint inherits
   * that automatically instead of re-implementing it.
   *
   * Not paginated, on purpose. A menu is a single document to a customer;
   * splitting it across pages would mean a phone at a table showing half a
   * menu. `MAX_CATEGORIES_PER_RESTAURANT` and the per-category item cap are
   * what keep that document bounded.
   */
  async getPublicMenu(slug: string) {
    const restaurant = await restaurantService.getPublicBySlug(slug);
    const categories = await categoryRepository.findPublicMenu(restaurant.id);

    return {
      restaurant: { id: restaurant.id, name: restaurant.name, slug: restaurant.slug },
      categories: categories.map((category) => toPublicCategory(category, restaurant.currency)),
    };
  },

  // -------------------------------------------------------------------------
  // Admin surface — authenticated and scoped to the caller's memberships.
  // -------------------------------------------------------------------------

  async list(userId: string, restaurantId: string, query: ListCategoriesQuery) {
    await membershipService.authorize(userId, restaurantId, "menu:read");

    const where: PrismaTypes.CategoryWhereInput =
      query.isActive === undefined ? {} : { isActive: query.isActive };
    const { skip, take } = paginate(query);

    const [rows, total] = await Promise.all([
      categoryRepository.findMany({ restaurantId, skip, take, where }),
      categoryRepository.count(restaurantId, where),
    ]);

    // `_count` is Prisma's shape, not a wire contract. Flattening it to
    // `menuItemCount` keeps the internal representation out of the response.
    const items = rows.map(({ _count, ...category }) => ({
      ...category,
      menuItemCount: _count.menuItems,
    }));

    return { items, total, page: query.page, limit: query.limit };
  },

  async getById(userId: string, restaurantId: string, categoryId: string) {
    await membershipService.authorize(userId, restaurantId, "menu:read");

    const category = await categoryRepository.findScoped(restaurantId, categoryId);
    if (!category) {
      throw new NotFoundError(`Category "${categoryId}" not found`);
    }
    return category;
  },

  async create(userId: string, restaurantId: string, input: CreateCategoryInput) {
    await membershipService.authorize(userId, restaurantId, "menu:write");

    const slug = input.slug ?? deriveSlug(input.name);
    await assertSlugAvailable(restaurantId, slug);

    const existing = await categoryRepository.count(restaurantId);
    if (existing >= MAX_CATEGORIES_PER_RESTAURANT) {
      throw new ConflictError(
        `A restaurant may have at most ${MAX_CATEGORIES_PER_RESTAURANT} categories`,
      );
    }

    try {
      return await categoryRepository.create({
        ...input,
        slug,
        // Taken from the authorized URL scope, never from the request body.
        restaurantId,
        position: input.position ?? (await nextPosition(restaurantId)),
      });
    } catch (error) {
      asSlugConflict(error, slug);
    }
  },

  async update(
    userId: string,
    restaurantId: string,
    categoryId: string,
    input: UpdateCategoryInput,
  ) {
    await membershipService.authorize(userId, restaurantId, "menu:write");

    if (input.slug) {
      await assertSlugAvailable(restaurantId, input.slug, categoryId);
    }

    try {
      return await categoryRepository.update(restaurantId, categoryId, input);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        asSlugConflict(error, input.slug ?? "");
      }
      asNotFound(error, categoryId);
    }
  },

  /**
   * Deleting a category is refused while it still holds menu items, unless the
   * caller explicitly asks for the items to go too.
   *
   * The alternative — cascading silently — means one mis-click destroys an
   * entire section of a restaurant's menu with no warning and no undo. Making
   * the caller state the intent costs one query parameter.
   */
  async remove(userId: string, restaurantId: string, categoryId: string, force: boolean) {
    await membershipService.authorize(userId, restaurantId, "menu:delete");

    const category = await categoryRepository.findScoped(restaurantId, categoryId);
    if (!category) {
      throw new NotFoundError(`Category "${categoryId}" not found`);
    }

    const itemCount = await categoryRepository.countMenuItems(categoryId);

    if (itemCount > 0 && !force) {
      throw new ConflictError(
        `Category "${category.name}" still contains ${itemCount} menu item(s). ` +
          `Move or delete them first, or repeat this request with ?force=true.`,
      );
    }

    if (itemCount > 0) {
      await categoryRepository.deleteWithItems(restaurantId, categoryId);
      return;
    }

    await categoryRepository.delete(restaurantId, categoryId);
  },
};

/**
 * Reshapes a stored row into the customer-facing view.
 *
 * The currency comes from the restaurant rather than the item, so every price
 * on one menu is necessarily in the same currency — that cannot be expressed
 * by a per-item column, only by construction.
 */
function toPublicCategory(category: PublicMenuCategory, currency: string) {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    menuItems: category.menuItems.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      price: toMoney(item.priceMinor, currency),
      // Returned rather than hidden: a customer who cannot find yesterday's
      // dish assumes the menu is broken. "Unavailable" is information.
      isAvailable: item.isAvailable,
    })),
  };
}
