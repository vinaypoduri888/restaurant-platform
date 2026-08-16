import { db, type Prisma } from "@repo/database";

/**
 * Fields safe to expose on the public (unauthenticated) API.
 *
 * Contact details, timestamps, and the active flag are deliberately excluded —
 * a customer browsing a menu has no need for them, and `email`/`phone` are
 * the restaurant's own contact data rather than public listing information.
 */
export const PUBLIC_RESTAURANT_FIELDS = {
  id: true,
  name: true,
  slug: true,
  description: true,
  address: true,
  city: true,
  country: true,
} satisfies Prisma.RestaurantSelect;

interface ListParams {
  skip: number;
  take: number;
  where: Prisma.RestaurantWhereInput;
}

/**
 * Deterministic ordering for every list query.
 *
 * `createdAt` alone is not a total order — two rows created in the same
 * millisecond could swap between pages and cause an item to be shown twice or
 * skipped. Appending the unique `id` makes the sort stable.
 */
const STABLE_ORDER: Prisma.RestaurantOrderByWithRelationInput[] = [
  { createdAt: "desc" },
  { id: "desc" },
];

export const restaurantRepository = {
  findMany({ skip, take, where }: ListParams) {
    return db.restaurant.findMany({ where, skip, take, orderBy: STABLE_ORDER });
  },

  findManyPublic({ skip, take, where }: ListParams) {
    return db.restaurant.findMany({
      where,
      skip,
      take,
      orderBy: STABLE_ORDER,
      select: PUBLIC_RESTAURANT_FIELDS,
    });
  },

  count(where: Prisma.RestaurantWhereInput) {
    return db.restaurant.count({ where });
  },

  findById(id: string) {
    return db.restaurant.findUnique({ where: { id } });
  },

  findPublicBySlug(slug: string) {
    return db.restaurant.findFirst({
      where: { slug, isActive: true },
      select: PUBLIC_RESTAURANT_FIELDS,
    });
  },

  findBySlug(slug: string) {
    return db.restaurant.findUnique({ where: { slug } });
  },

  create(data: Prisma.RestaurantCreateInput) {
    return db.restaurant.create({ data });
  },

  update(id: string, data: Prisma.RestaurantUpdateInput) {
    return db.restaurant.update({ where: { id }, data });
  },

  delete(id: string) {
    return db.restaurant.delete({ where: { id } });
  },

  /**
   * Creates a restaurant and its owner membership atomically.
   *
   * A transaction matters here: a restaurant with no owner would be
   * unreachable through the admin API and effectively orphaned.
   */
  createWithOwner(data: Prisma.RestaurantCreateInput, userId: string) {
    return db.$transaction(async (tx) => {
      const restaurant = await tx.restaurant.create({ data });
      await tx.restaurantMembership.create({
        data: { userId, restaurantId: restaurant.id, role: "OWNER" },
      });
      return restaurant;
    });
  },
};
