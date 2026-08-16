import { Prisma, type Prisma as PrismaTypes } from "@repo/database";
import type {
  CreateRestaurantInput,
  ListRestaurantsQuery,
  UpdateRestaurantInput,
} from "@repo/validation/restaurant";
import { ConflictError, NotFoundError } from "../../shared/errors.ts";
import { membershipService } from "../auth/membership.service.ts";
import { restaurantRepository } from "./restaurant.repository.ts";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

async function assertSlugAvailable(slug: string, excludeId?: string) {
  const existing = await restaurantRepository.findBySlug(slug);
  if (existing && existing.id !== excludeId) {
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

  async getPublicBySlug(slug: string) {
    const restaurant = await restaurantRepository.findPublicBySlug(slug);
    if (!restaurant) {
      throw new NotFoundError(`Restaurant "${slug}" not found`);
    }
    return restaurant;
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

  async getForUser(userId: string, id: string) {
    // Authorize first: this throws 403 for both "not a member" and "does not
    // exist", so the API never confirms which restaurant ids are real.
    await membershipService.authorize(userId, id, "restaurant:read");

    const restaurant = await restaurantRepository.findById(id);
    if (!restaurant) {
      throw new NotFoundError(`Restaurant "${id}" not found`);
    }
    return restaurant;
  },

  /** Creates a restaurant; the creating user becomes its OWNER. */
  async create(userId: string, input: CreateRestaurantInput) {
    const slug = input.slug ?? slugify(input.name);
    await assertSlugAvailable(slug);

    try {
      return await restaurantRepository.createWithOwner({ ...input, slug }, userId);
    } catch (error) {
      asSlugConflict(error, slug);
    }
  },

  async update(userId: string, id: string, input: UpdateRestaurantInput) {
    await membershipService.authorize(userId, id, "restaurant:update");

    if (input.slug) {
      await assertSlugAvailable(input.slug, id);
    }

    try {
      return await restaurantRepository.update(id, input);
    } catch (error) {
      asSlugConflict(error, input.slug ?? "");
    }
  },

  async remove(userId: string, id: string) {
    await membershipService.authorize(userId, id, "restaurant:delete");
    await restaurantRepository.delete(id);
  },
};
