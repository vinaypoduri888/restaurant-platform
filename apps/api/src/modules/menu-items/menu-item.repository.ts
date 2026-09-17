import { db, type Prisma } from "@repo/database";

/** See `category.repository.ts` — `position` is not unique, so it cannot be a total order on its own. */
const MENU_ITEM_ORDER: Prisma.MenuItemOrderByWithRelationInput[] = [
  { position: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
];

interface ListParams {
  restaurantId: string;
  skip: number;
  take: number;
  where: Prisma.MenuItemWhereInput;
}

export const menuItemRepository = {
  findMany({ restaurantId, skip, take, where }: ListParams) {
    return db.menuItem.findMany({
      where: { ...where, restaurantId },
      skip,
      take,
      orderBy: MENU_ITEM_ORDER,
    });
  },

  count(restaurantId: string, where: Prisma.MenuItemWhereInput = {}) {
    return db.menuItem.count({ where: { ...where, restaurantId } });
  },

  countInCategory(restaurantId: string, categoryId: string) {
    return db.menuItem.count({ where: { restaurantId, categoryId } });
  },

  /** Always scoped by tenant: an id from another restaurant must read as absent. */
  findScoped(restaurantId: string, menuItemId: string) {
    return db.menuItem.findFirst({ where: { id: menuItemId, restaurantId } });
  },

  /** Highest position within one category, or `null` when the category is empty. */
  async maxPosition(restaurantId: string, categoryId: string): Promise<number | null> {
    const result = await db.menuItem.aggregate({
      where: { restaurantId, categoryId },
      _max: { position: true },
    });
    return result._max.position;
  },

  create(data: Prisma.MenuItemUncheckedCreateInput) {
    return db.menuItem.create({ data });
  },

  /**
   * The tenant filter sits in the `where` of the write itself, not only in a
   * preceding read, so there is no window in which the two could disagree.
   */
  update(restaurantId: string, menuItemId: string, data: Prisma.MenuItemUpdateInput) {
    return db.menuItem.update({ where: { id: menuItemId, restaurantId }, data });
  },

  delete(restaurantId: string, menuItemId: string) {
    return db.menuItem.delete({ where: { id: menuItemId, restaurantId } });
  },
};
