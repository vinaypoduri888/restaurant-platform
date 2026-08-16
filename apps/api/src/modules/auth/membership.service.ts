import { db, type RestaurantMembership, type RestaurantRole } from "@repo/database";
import { ForbiddenError } from "../../shared/errors.ts";

/**
 * Capabilities are named after what a caller wants to *do*, not after roles.
 *
 * Routes ask for a capability; only this file knows which roles grant it. That
 * means adding a role later (MANAGER, say) changes one table here rather than
 * every route that currently checks `role === "OWNER"`.
 */
export type Capability =
  | "restaurant:read"
  | "restaurant:update"
  | "restaurant:delete"
  | "member:manage";

const ROLE_CAPABILITIES: Record<RestaurantRole, readonly Capability[]> = {
  OWNER: ["restaurant:read", "restaurant:update", "restaurant:delete", "member:manage"],
  STAFF: ["restaurant:read", "restaurant:update"],
};

export const membershipService = {
  /** Restaurant ids the user has any membership in. */
  async listRestaurantIdsForUser(userId: string): Promise<string[]> {
    const memberships = await db.restaurantMembership.findMany({
      where: { userId },
      select: { restaurantId: true },
    });
    return memberships.map((membership) => membership.restaurantId);
  },

  async findRole(userId: string, restaurantId: string): Promise<RestaurantRole | null> {
    const membership = await db.restaurantMembership.findUnique({
      where: { userId_restaurantId: { userId, restaurantId } },
      select: { role: true },
    });
    return membership?.role ?? null;
  },

  /**
   * Authorization gate for a single restaurant.
   *
   * Throws `ForbiddenError` both when the user has no membership and when the
   * membership lacks the capability. Those two cases deliberately produce the
   * same response so the API does not reveal which restaurant ids exist.
   */
  async authorize(userId: string, restaurantId: string, capability: Capability): Promise<void> {
    const role = await this.findRole(userId, restaurantId);

    if (!role || !ROLE_CAPABILITIES[role].includes(capability)) {
      throw new ForbiddenError("You do not have access to this restaurant");
    }
  },

  /** Records the creator of a restaurant as its owner. */
  createOwnerMembership(userId: string, restaurantId: string): Promise<RestaurantMembership> {
    return db.restaurantMembership.create({
      data: { userId, restaurantId, role: "OWNER" },
    });
  },
};
