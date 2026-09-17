import { Prisma, type Prisma as PrismaTypes } from "@repo/database";
import { DAYS_OF_WEEK, type ReplaceOperatingHoursInput } from "@repo/validation/operating-hours";
import type {
  CreateRestaurantInput,
  ListRestaurantsQuery,
  UpdateRestaurantInput,
} from "@repo/validation/restaurant";
import { ConflictError, NotFoundError } from "../../shared/errors.ts";
import { isOvernight, resolveOpenStatus, type DayHours } from "../../shared/opening-hours.ts";
import { deriveSlug } from "../../shared/slug.ts";
import { membershipService } from "../auth/membership.service.ts";
import { mediaService } from "../media/media.service.ts";
import { restaurantRepository } from "./restaurant.repository.ts";

/**
 * Turns Prisma's unique-constraint violation into a domain error.
 *
 * The service checks slug availability before writing, but that check and the
 * write are not atomic — two concurrent requests can both pass it. The database
 * unique index is the real guarantee; this maps its failure back to a clean 409
 * instead of a 500.
 */
function asSlugConflict(error: unknown, slug: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ConflictError(`Slug "${slug}" is already in use`);
  }
  throw error;
}

/**
 * Refuses a slug that any restaurant has ever held.
 *
 * Deliberately checks the slug *registry* rather than `restaurants.slug`. A
 * retired slug stays reserved — printed QR codes still point at it — so
 * "available" has to mean "never claimed by anyone", not merely "not currently
 * in use". Checking only current slugs would let restaurant B take over
 * restaurant A's old URL and silently inherit its customers' codes.
 *
 * `excludeId` lets a restaurant reclaim a slug it used to hold itself, which is
 * a reverted rename rather than a collision.
 *
 * This is a courtesy check that produces a clean 409 before any write. It is
 * not the guarantee — `restaurant_slugs.slug` is, and it is consulted again by
 * the database on every insert.
 */
async function assertSlugAvailable(slug: string, excludeId?: string) {
  const reserved = await restaurantRepository.findRestaurantIdBySlug(slug);
  if (reserved && reserved.restaurantId !== excludeId) {
    // Says nothing about *which* restaurant holds it.
    throw new ConflictError(`Slug "${slug}" is already in use`);
  }
}

function paginate(query: ListRestaurantsQuery) {
  return { skip: (query.page - 1) * query.limit, take: query.limit };
}

export const restaurantService = {
  // -------------------------------------------------------------------------
  // Public surface — unauthenticated, active restaurants only, reduced fields.
  // -------------------------------------------------------------------------

  async listPublic(query: ListRestaurantsQuery) {
    const where: PrismaTypes.RestaurantWhereInput = { isActive: true };
    const { skip, take } = paginate(query);

    const [items, total] = await Promise.all([
      restaurantRepository.findManyPublic({ skip, take, where }),
      restaurantRepository.count(where),
    ]);

    return { items, total, page: query.page, limit: query.limit };
  },

  /**
   * One publicly visible restaurant, with its hours and whether it is open now.
   *
   * The status is computed **here**, on the server, from the restaurant's own
   * time zone — never in the browser. A visitor in London looking at a Mumbai
   * menu must be told whether the restaurant is open in Mumbai, and the
   * visitor's device knows nothing about that.
   *
   * `new Date()` is read once, at this boundary, and passed into a pure
   * function. That is what keeps the calculation itself testable at explicit
   * instants rather than only at whatever time the suite happens to run.
   *
   * Accepts a **retired** slug as well as the current one. A QR code is printed
   * and stuck to a table, so the URL it carries is effectively immutable; if a
   * rename broke it, every code already in the wild would stop working. The
   * returned record always carries the restaurant's *current* `slug`, which is
   * how a caller detects that it arrived on an old one and can redirect to the
   * canonical URL. No extra field is needed for that, and none is added.
   */
  async getPublicBySlug(slug: string, now: Date = new Date()) {
    const restaurant = await this.resolvePublic(slug);
    if (!restaurant) {
      throw new NotFoundError(`Restaurant "${slug}" not found`);
    }

    const { operatingHours, ...fields } = restaurant;

    return {
      ...fields,
      status: resolveOpenStatus(operatingHours, restaurant.timeZone, now),
      hours: operatingHours.map(toPublicDayHours),
      // Cross-module call to a *service*, which the architecture permits —
      // never to another module's repository.
      branding: await mediaService.publicBranding(restaurant.id),
    };
  },

  /**
   * Finds an active restaurant by any slug it has ever held.
   *
   * The current slug is tried first, as a single unique-index lookup — that is
   * the overwhelmingly common case and the hottest read in the system. Only a
   * miss falls through to the registry, so a retired slug costs one extra round
   * trip and a current one costs nothing.
   *
   * Returns `null` for an unknown slug *and* for a slug whose restaurant is
   * inactive, so a deactivated restaurant behaves exactly like one that never
   * existed. A retired slug must not become a way to discover that a restaurant
   * was hidden.
   */
  async resolvePublic(slug: string) {
    const current = await restaurantRepository.findPublicBySlug(slug);
    if (current) {
      return current;
    }

    const reserved = await restaurantRepository.findRestaurantIdBySlug(slug);
    if (!reserved) {
      return null;
    }

    return restaurantRepository.findPublicById(reserved.restaurantId);
  },

  // -------------------------------------------------------------------------
  // Admin surface — authenticated and scoped to the caller's memberships.
  // -------------------------------------------------------------------------

  /** Lists only restaurants the user is a member of. */
  async listForUser(userId: string, query: ListRestaurantsQuery) {
    const restaurantIds = await membershipService.listRestaurantIdsForUser(userId);

    if (restaurantIds.length === 0) {
      return { items: [], total: 0, page: query.page, limit: query.limit };
    }

    const where: PrismaTypes.RestaurantWhereInput = {
      id: { in: restaurantIds },
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    };
    const { skip, take } = paginate(query);

    const [items, total] = await Promise.all([
      restaurantRepository.findMany({ skip, take, where }),
      restaurantRepository.count(where),
    ]);

    return { items, total, page: query.page, limit: query.limit };
  },

  /**
   * One restaurant, plus the caller's own role in it.
   *
   * The role is returned so the admin console can show only the controls the
   * caller can actually use — a STAFF member being offered a delete button that
   * always refuses is a poor experience, not a security boundary.
   *
   * It comes from `authorize`, which read the membership row to make its
   * decision: the value is therefore derived from the authenticated session and
   * the database, never from anything the client sent, and it cannot be
   * obtained without first passing the authorization check. There is no extra
   * query.
   *
   * This remains informational only. Every write re-authorizes independently,
   * so a client that ignored or forged this value would gain nothing.
   */
  async getForUser(userId: string, id: string) {
    // Authorize first: this throws 403 for both "not a member" and "does not
    // exist", so the API never confirms which restaurant ids are real.
    const role = await membershipService.authorize(userId, id, "restaurant:read");

    const restaurant = await restaurantRepository.findById(id);
    if (!restaurant) {
      throw new NotFoundError(`Restaurant "${id}" not found`);
    }
    return { restaurant, role };
  },

  /** Creates a restaurant; the creating user becomes its OWNER. */
  async create(userId: string, input: CreateRestaurantInput) {
    const slug = input.slug ?? deriveSlug(input.name);
    await assertSlugAvailable(slug);

    try {
      return await restaurantRepository.createWithOwner({ ...input, slug }, userId);
    } catch (error) {
      asSlugConflict(error, slug);
    }
  },

  /**
   * Updates a restaurant, including renaming its public URL.
   *
   * Slug changes go through the existing update contract rather than a second
   * endpoint: a slug is a field of the restaurant, `restaurant:update` is
   * already the capability that governs editing it, and a dedicated
   * `PATCH .../slug` route would duplicate that authorization for no gain.
   *
   * A slug change is a strictly bigger operation than any other field — it also
   * reserves the new slug — so it takes a different repository path. Everything
   * else is an ordinary update.
   *
   * STAFF may rename, because STAFF holds `restaurant:update`. That is the
   * existing rule and this phase does not narrow it; nothing is lost if they
   * do, since the old URL keeps working.
   */
  async update(userId: string, id: string, input: UpdateRestaurantInput) {
    await membershipService.authorize(userId, id, "restaurant:update");

    const { slug } = input;

    if (!slug) {
      return restaurantRepository.update(id, input);
    }

    await assertSlugAvailable(slug, id);

    try {
      return await restaurantRepository.updateWithNewSlug(id, input, slug);
    } catch (error) {
      asSlugConflict(error, slug);
    }
  },

  /**
   * Deletes a restaurant and everything belonging to it.
   *
   * The database cascade removes categories, menu items, hours, memberships and
   * media *metadata* — but a foreign key cannot reach object storage. So the
   * media keys are collected first and their objects removed after the delete
   * commits. Without that step every deleted restaurant would leave its images
   * behind forever, which a live check caught.
   *
   * Objects are purged *after*, not before: deleting them first would destroy
   * live images if the database delete then failed.
   */
  async remove(userId: string, id: string) {
    await membershipService.authorize(userId, id, "restaurant:delete");

    // Read while the rows still exist — the cascade is about to remove them,
    // and with them any record of which objects belonged to this restaurant.
    const mediaKeys = await mediaService.listStorageKeys(id);

    await restaurantRepository.delete(id);

    // Best effort: a storage failure must not fail a delete that has already
    // committed. Anything left behind is unreachable, since serving an object
    // requires a database row.
    await mediaService.purgeObjects(mediaKeys);
  },

  // -------------------------------------------------------------------------
  // Operating hours — part of the restaurant profile, so they live in this
  // module rather than in one of their own. They have no meaning, no
  // authorization boundary, and no lifecycle independent of a restaurant.
  // -------------------------------------------------------------------------

  /**
   * The full week for an administrator.
   *
   * Padded to all seven days, with anything unconfigured presented as closed,
   * because the editor renders a row per day and would otherwise have to invent
   * the missing ones itself. The *public* read deliberately does not pad — see
   * `getPublicBySlug`, where "not configured yet" must stay distinguishable
   * from "closed every day".
   */
  async getHoursForUser(userId: string, restaurantId: string) {
    await membershipService.authorize(userId, restaurantId, "restaurant:read");

    const stored = await restaurantRepository.findOperatingHours(restaurantId);
    const byDay = new Map(stored.map((entry) => [entry.dayOfWeek, entry]));

    return {
      days: DAYS_OF_WEEK.map(
        (dayOfWeek) =>
          byDay.get(dayOfWeek) ?? {
            dayOfWeek,
            isClosed: true,
            opensAt: null,
            closesAt: null,
          },
      ).map(toPublicDayHours),
    };
  },

  /**
   * Replaces the week.
   *
   * Requires `restaurant:update`, the same capability that already governs the
   * rest of the restaurant profile — opening hours are profile data, so
   * inventing a separate capability for them would fragment a policy that is
   * currently readable in one table.
   *
   * The restaurant id comes from the authorized URL scope; nothing in the body
   * can redirect the write to another tenant.
   */
  async replaceHours(userId: string, restaurantId: string, input: ReplaceOperatingHoursInput) {
    await membershipService.authorize(userId, restaurantId, "restaurant:update");

    const days = input.days.map((day) => ({
      restaurantId,
      dayOfWeek: day.dayOfWeek,
      isClosed: day.isClosed,
      // Validation guarantees these are both present or both absent; `?? null`
      // normalises `undefined` for Prisma without weakening that guarantee.
      opensAt: day.isClosed ? null : (day.opensAt ?? null),
      closesAt: day.isClosed ? null : (day.closesAt ?? null),
    }));

    const saved = await restaurantRepository.replaceOperatingHours(restaurantId, days);
    return { days: saved.map(toPublicDayHours) };
  },
};

/**
 * The wire shape for one day.
 *
 * `isOvernight` is derived here rather than left to each client. Both the public
 * page and the admin editor have to present an overnight period differently —
 * 22:00→02:00 must not read as an invalid same-day interval — and having two
 * frontends each re-derive `closesAt < opensAt` is exactly how that rule drifts.
 */
function toPublicDayHours(day: DayHours) {
  return {
    dayOfWeek: day.dayOfWeek,
    isClosed: day.isClosed,
    opensAt: day.opensAt,
    closesAt: day.closesAt,
    isOvernight: isOvernight(day),
  };
}
