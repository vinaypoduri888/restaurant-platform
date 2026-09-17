import { db, type Prisma } from "@repo/database";

/**
 * Deterministic ordering, everywhere.
 *
 * `position` is the curated order the restaurant chose, but it is not unique —
 * two categories created concurrently can share one. Without the tiebreakers a
 * tie would be resolved by PostgreSQL's physical row order, which can change
 * after any update, so a customer could see two different menus on two
 * refreshes with no data having changed.
 */
const CATEGORY_ORDER: Prisma.CategoryOrderByWithRelationInput[] = [
  { position: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
];

const MENU_ITEM_ORDER: Prisma.MenuItemOrderByWithRelationInput[] = [
  { position: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
];

/**
 * The public menu projection.
 *
 * Written as an explicit `select` rather than returning rows: `isActive`,
 * `position`, `restaurantId`, and the timestamps are internal bookkeeping and
 * a customer has no use for any of them. `priceMinor` and `currency` are
 * reshaped into a money object by the service.
 */
const PUBLIC_MENU_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  menuItems: {
    // Unpublished items are excluded here, in the same query, rather than
    // being fetched and filtered in JavaScript.
    where: { isActive: true },
    orderBy: MENU_ITEM_ORDER,
    select: {
      id: true,
      name: true,
      description: true,
      priceMinor: true,
      isAvailable: true,
    },
  },
} satisfies Prisma.CategorySelect;

export type PublicMenuCategory = Prisma.CategoryGetPayload<{ select: typeof PUBLIC_MENU_SELECT }>;

interface ListParams {
  restaurantId: string;
  skip: number;
  take: number;
  where: Prisma.CategoryWhereInput;
}

export const categoryRepository = {
  /**
   * The whole published menu for one restaurant.
   *
   * Prisma resolves this as two statements — one for the categories, one for
   * their items with an `IN (...)` — regardless of how many categories exist.
   * Fetching categories and then looping to fetch each one's items would be
   * the N+1 this deliberately avoids.
   */
  findPublicMenu(restaurantId: string): Promise<PublicMenuCategory[]> {
    return db.category.findMany({
      where: { restaurantId, isActive: true },
      orderBy: CATEGORY_ORDER,
      select: PUBLIC_MENU_SELECT,
    });
  },

  /**
   * Admin category list, each row carrying how many menu items it holds.
   *
   * The count comes from the database via `_count` rather than being derived in
   * the console from a page of items. That approach silently under-counted: a
   * restaurant may hold far more items than the API's 100-row page limit, so
   * any section beyond the first page reported zero — and the delete
   * confirmation then told an owner a section was empty when it was not.
   *
   * Prisma resolves `_count` as part of the same query, so this adds no round
   * trip and no N+1.
   */
  findMany({ restaurantId, skip, take, where }: ListParams) {
    return db.category.findMany({
      where: { ...where, restaurantId },
      skip,
      take,
      orderBy: CATEGORY_ORDER,
      include: { _count: { select: { menuItems: true } } },
    });
  },

  count(restaurantId: string, where: Prisma.CategoryWhereInput = {}) {
    return db.category.count({ where: { ...where, restaurantId } });
  },

  /**
   * Every single-record read is scoped by `restaurantId`, never by id alone.
   * A caller holding a valid id from another restaurant must get the same
   * answer as one holding a fabricated id.
   */
  findScoped(restaurantId: string, categoryId: string) {
    return db.category.findFirst({ where: { id: categoryId, restaurantId } });
  },

  findBySlug(restaurantId: string, slug: string) {
    return db.category.findUnique({ where: { restaurantId_slug: { restaurantId, slug } } });
  },

  /** Highest position currently in use, or `null` when the menu is empty. */
  async maxPosition(restaurantId: string): Promise<number | null> {
    const result = await db.category.aggregate({
      where: { restaurantId },
      _max: { position: true },
    });
    return result._max.position;
  },

  create(data: Prisma.CategoryUncheckedCreateInput) {
    return db.category.create({ data });
  },

  /**
   * Updates through the `(id, restaurant_id)` unique constraint, so the tenant
   * check is part of the write itself rather than a separate query that could
   * race with a concurrent move.
   */
  update(restaurantId: string, categoryId: string, data: Prisma.CategoryUpdateInput) {
    return db.category.update({
      where: { id_restaurantId: { id: categoryId, restaurantId } },
      data,
    });
  },

  delete(restaurantId: string, categoryId: string) {
    return db.category.delete({
      where: { id_restaurantId: { id: categoryId, restaurantId } },
    });
  },

  countMenuItems(categoryId: string) {
    return db.menuItem.count({ where: { categoryId } });
  },

  /**
   * Deletes a category together with its items, in one transaction.
   *
   * The database refuses to drop a category that still has items (that is what
   * stops orphans existing at all), so the items must go first — and both
   * statements must succeed or neither should, otherwise a failure halfway
   * would leave a section stripped of its dishes but still on the menu.
   */
  deleteWithItems(restaurantId: string, categoryId: string) {
    return db.$transaction(async (tx) => {
      await tx.menuItem.deleteMany({ where: { categoryId, restaurantId } });
      return tx.category.delete({ where: { id_restaurantId: { id: categoryId, restaurantId } } });
    });
  },
};
