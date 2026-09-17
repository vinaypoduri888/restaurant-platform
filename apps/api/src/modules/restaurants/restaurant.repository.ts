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
  // Public because it describes the menu a customer is about to read, not the
  // restaurant's own private data.
  currency: true,
} satisfies Prisma.RestaurantSelect;

/**
 * Fields for the public *detail* endpoint, which additionally carries the
 * restaurant's time zone and its week of operating hours.
 *
 * Kept separate from the list projection on purpose: the list is the
 * highest-traffic surface, and attaching seven hours rows to every row of every
 * page would be a lot of bytes nobody has asked for. Hours belong to the page a
 * customer is actually standing in front of.
 */
export const PUBLIC_RESTAURANT_DETAIL_FIELDS = {
  ...PUBLIC_RESTAURANT_FIELDS,
  // Needed to interpret the hours below — they are wall-clock times in it.
  timeZone: true,
  operatingHours: {
    // The enum's declaration order is Monday-first, and PostgreSQL sorts enums
    // by that order, so the week arrives already in reading order.
    orderBy: { dayOfWeek: "asc" },
    select: { dayOfWeek: true, isClosed: true, opensAt: true, closesAt: true },
  },
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
      select: PUBLIC_RESTAURANT_DETAIL_FIELDS,
    });
  },

  /**
   * The same public projection, addressed by id.
   *
   * Used only after a *historical* slug has been resolved to a restaurant.
   * Public callers never supply an id — it stays internal.
   */
  findPublicById(id: string) {
    return db.restaurant.findFirst({
      where: { id, isActive: true },
      select: PUBLIC_RESTAURANT_DETAIL_FIELDS,
    });
  },

  /**
   * Resolves any slug the restaurant has ever held to its id.
   *
   * Separate from `findPublicBySlug` rather than folded into it with an `OR`.
   * An `OR` across a local unique column and a related-table condition is one
   * query, but it gives the planner a choice it can get wrong — and this is the
   * hottest read in the system. Keeping the current-slug path a plain unique
   * index lookup means the common case stays predictable, and the extra round
   * trip is paid only by the rare request that arrives on a retired slug.
   */
  findRestaurantIdBySlug(slug: string) {
    return db.restaurantSlug.findUnique({
      where: { slug },
      select: { restaurantId: true },
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
  /**
   * One restaurant's week of hours, in day order.
   *
   * Returns whatever is stored — possibly nothing. "Not configured" is a real
   * state the service distinguishes from "closed every day", and padding it
   * here would destroy that distinction before anyone could act on it.
   */
  findOperatingHours(restaurantId: string) {
    return db.operatingHours.findMany({
      where: { restaurantId },
      orderBy: { dayOfWeek: "asc" },
      select: { dayOfWeek: true, isClosed: true, opensAt: true, closesAt: true },
    });
  },

  /**
   * Replaces the whole week atomically.
   *
   * Delete-then-insert rather than seven upserts: the week is one document, and
   * a transaction makes the swap all-or-nothing. A partial failure part-way
   * through seven independent upserts would leave a schedule that is half old
   * and half new — worse than either.
   */
  replaceOperatingHours(restaurantId: string, days: Prisma.OperatingHoursCreateManyInput[]) {
    return db.$transaction(async (tx) => {
      await tx.operatingHours.deleteMany({ where: { restaurantId } });
      await tx.operatingHours.createMany({ data: days });

      return tx.operatingHours.findMany({
        where: { restaurantId },
        orderBy: { dayOfWeek: "asc" },
        select: { dayOfWeek: true, isClosed: true, opensAt: true, closesAt: true },
      });
    });
  },

  /**
   * Creates a restaurant, its owner membership, and its first slug record —
   * atomically.
   *
   * The slug record is not optional bookkeeping. `restaurant_slugs.slug` is the
   * unique index that makes a slug belong to one restaurant forever, so a
   * restaurant whose current slug is missing from it is a hole in that
   * guarantee: another restaurant could claim the slug and nothing would
   * object. Creating both in one transaction is what closes it.
   */
  createWithOwner(data: Prisma.RestaurantCreateInput, userId: string) {
    return db.$transaction(async (tx) => {
      const restaurant = await tx.restaurant.create({ data });
      await tx.restaurantMembership.create({
        data: { userId, restaurantId: restaurant.id, role: "OWNER" },
      });
      await tx.restaurantSlug.create({
        data: { restaurantId: restaurant.id, slug: restaurant.slug },
      });
      return restaurant;
    });
  },

  /**
   * Applies an update that changes the slug, reserving the new slug first.
   *
   * ─── Why this is one transaction ────────────────────────────────────────────
   *
   * Two rows must agree: `restaurants.slug` (the current slug) and the
   * `restaurant_slugs` row reserving it. Writing them separately leaves a
   * window where the restaurant answers on a slug nothing has reserved, or a
   * slug is reserved for a restaurant that never adopted it.
   *
   * ─── Why a reclaim is allowed ───────────────────────────────────────────────
   *
   * If the target slug is already reserved *by this restaurant*, it is one the
   * restaurant used to hold and is changing back to — a reverted rename. That
   * is legitimate, so the existing reservation is reused rather than
   * duplicated.
   *
   * Anything else attempts the insert and lets `restaurant_slugs.slug` decide.
   * The read below is an optimisation for the reclaim case, never the
   * authorisation for the write: a concurrent request could reserve the slug
   * between the read and the insert, and only the unique index closes that
   * window. Its violation becomes a 409 in the service.
   */
  updateWithNewSlug(id: string, data: Prisma.RestaurantUpdateInput, slug: string) {
    return db.$transaction(async (tx) => {
      const reserved = await tx.restaurantSlug.findUnique({
        where: { slug },
        select: { restaurantId: true },
      });

      if (!reserved || reserved.restaurantId !== id) {
        await tx.restaurantSlug.create({ data: { restaurantId: id, slug } });
      }

      return tx.restaurant.update({ where: { id }, data });
    });
  },

  /** Every slug this restaurant has ever held, newest first. */
  findSlugHistory(restaurantId: string) {
    return db.restaurantSlug.findMany({
      where: { restaurantId },
      orderBy: [{ createdAt: "desc" }, { slug: "asc" }],
      select: { slug: true, createdAt: true },
    });
  },
};
