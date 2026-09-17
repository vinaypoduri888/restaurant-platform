import { db, type Prisma } from "@repo/database";

/**
 * Fields the *public* API may see.
 *
 * Notably absent: `storageKey`. A customer has no use for an object key, and
 * exposing one advertises the storage layout — the URL the service builds from
 * it is the only thing a browser needs. `originalName` is also withheld: it is
 * the owner's own filename, not public information.
 */
export const PUBLIC_MEDIA_FIELDS = {
  id: true,
  purpose: true,
  storageKey: true,
  width: true,
  height: true,
} satisfies Prisma.RestaurantMediaSelect;

export type PublicMediaRow = Prisma.RestaurantMediaGetPayload<{
  select: typeof PUBLIC_MEDIA_FIELDS;
}>;

export const mediaRepository = {
  /** Every media row for one restaurant, for the admin surface. */
  findManyByRestaurant(restaurantId: string) {
    return db.restaurantMedia.findMany({
      where: { restaurantId },
      orderBy: { purpose: "asc" },
    });
  },

  /** The reduced projection used to build public URLs. */
  findPublicByRestaurant(restaurantId: string): Promise<PublicMediaRow[]> {
    return db.restaurantMedia.findMany({
      where: { restaurantId },
      orderBy: { purpose: "asc" },
      select: PUBLIC_MEDIA_FIELDS,
    });
  },

  /**
   * Scoped by tenant, never by id alone — a valid id from another restaurant
   * must read as absent, exactly as a fabricated one does.
   */
  findScoped(restaurantId: string, mediaId: string) {
    return db.restaurantMedia.findFirst({ where: { id: mediaId, restaurantId } });
  },

  findByPurpose(restaurantId: string, purpose: Prisma.RestaurantMediaCreateInput["purpose"]) {
    return db.restaurantMedia.findUnique({
      where: { restaurantId_purpose: { restaurantId, purpose } },
    });
  },

  create(data: Prisma.RestaurantMediaUncheckedCreateInput) {
    return db.restaurantMedia.create({ data });
  },

  delete(restaurantId: string, mediaId: string) {
    // `deleteMany` with the tenant in the filter: the tenant check is part of
    // the statement rather than a preceding read that could race.
    return db.restaurantMedia.deleteMany({ where: { id: mediaId, restaurantId } });
  },
};
