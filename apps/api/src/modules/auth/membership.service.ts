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
  | "member:read"
  | "member:manage"
  | "menu:read"
  | "menu:write"
  | "menu:delete"
  | "media:read"
  | "media:write"
  | "media:delete"
  | "qr:read";

/**
 * Menu policy mirrors the restaurant policy: staff do the day-to-day work,
 * owners take the irreversible actions.
 *
 * Marking a dish sold out or fixing a price is exactly what floor staff are
 * there to do, so STAFF holds `menu:write`. Deleting a category or an item
 * destroys content, and staff already have `isActive` / `isAvailable` to take
 * something off the menu without losing it — so `menu:delete` is OWNER only.
 *
 * Media follows the same shape for the same reason. Replacing a logo is
 * ordinary branding work, so STAFF holds `media:write`. Deleting one destroys
 * the stored object with no "hide" alternative to fall back on, which puts it
 * with the other irreversible actions — so `media:delete` is OWNER only.
 *
 * `qr:read` is OWNER only, and it is the one capability here that is a
 * *product* decision rather than a confidentiality boundary. A QR code encodes
 * nothing but the restaurant's public menu URL — anyone holding the code can
 * read it, and the page it opens needs no account — so withholding it from
 * STAFF protects no secret. What it protects is the artefact: a QR code gets
 * printed, laminated and glued to a table, and the slug it carries then
 * constrains the restaurant's public URL for as long as that table is in
 * service. Committing to that belongs with the owner.
 *
 * It lives in this table rather than as a `role === "OWNER"` check in the QR
 * module precisely so that reasoning is recorded in one place and can be
 * revised in one place.
 */
const ROLE_CAPABILITIES: Record<RestaurantRole, readonly Capability[]> = {
  OWNER: [
    "restaurant:read",
    "restaurant:update",
    "restaurant:delete",
    "member:read",
    "member:manage",
    "menu:read",
    "menu:write",
    "menu:delete",
    "media:read",
    "media:write",
    "media:delete",
    "qr:read",
  ],
  STAFF: [
    "restaurant:read",
    /*
     * Staff may see who else is on the team, but never change it. Knowing
     * your colleagues is ordinary workplace information, and hiding it would
     * not protect anything — the names are visible on a shift rota anyway.
     * Every mutation stays behind `member:manage`, which is OWNER only.
     */
    "member:read",
    "restaurant:update",
    "menu:read",
    "menu:write",
    "media:read",
    "media:write",
  ],
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
   *
   * Returns the role that satisfied the check. The lookup happens here anyway,
   * so a caller that also needs to *report* the role — the admin console, to
   * decide which controls to show — can have it without a second query. It is
   * a return value rather than a new method precisely so that the role can only
   * ever be obtained by passing authorization first.
   */
  async authorize(
    userId: string,
    restaurantId: string,
    capability: Capability,
  ): Promise<RestaurantRole> {
    const role = await this.findRole(userId, restaurantId);

    if (!role || !ROLE_CAPABILITIES[role].includes(capability)) {
      throw new ForbiddenError("You do not have access to this restaurant");
    }

    return role;
  },

  /** Records the creator of a restaurant as its owner. */
  createOwnerMembership(userId: string, restaurantId: string): Promise<RestaurantMembership> {
    return db.restaurantMembership.create({
      data: { userId, restaurantId, role: "OWNER" },
    });
  },
};
