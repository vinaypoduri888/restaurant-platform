import { db, type Prisma, type RestaurantRole } from "@repo/database";

/**
 * Database access for team membership and invitations.
 *
 * Every query is scoped by `restaurantId` — the tenant comes from the
 * authorized URL scope, never from a request body, so a row from another
 * restaurant cannot be reached even with a correct id.
 */

/**
 * What the team list exposes about a person.
 *
 * `email` and `name` are joined from `User` because a roster of opaque ids is
 * useless. Nothing else from that table is selected: `emailVerified` is between
 * a user and the platform rather than their colleagues, and the Better Auth
 * columns hold credentials.
 */
const MEMBER_FIELDS = {
  userId: true,
  role: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.RestaurantMembershipSelect;

/** An invitation as the console shows it — deliberately without `tokenHash`. */
const INVITATION_FIELDS = {
  id: true,
  email: true,
  role: true,
  expiresAt: true,
  acceptedAt: true,
  createdAt: true,
} satisfies Prisma.RestaurantInvitationSelect;

export const memberRepository = {
  listMembers(restaurantId: string) {
    return db.restaurantMembership.findMany({
      where: { restaurantId },
      select: MEMBER_FIELDS,
      /*
       * Owners first, then oldest first. A total order: `createdAt` alone can
       * tie, and a roster that reshuffles between reloads looks broken.
       */
      orderBy: [{ role: "asc" }, { createdAt: "asc" }, { userId: "asc" }],
    });
  },

  findMembership(restaurantId: string, userId: string) {
    return db.restaurantMembership.findUnique({
      where: { userId_restaurantId: { userId, restaurantId } },
      select: MEMBER_FIELDS,
    });
  },

  /**
   * How many OWNERs the restaurant has.
   *
   * Read inside the transaction that is about to remove or demote one — a
   * count taken beforehand can be stale by the time the write lands, which is
   * exactly how a restaurant ends up with nobody who can administer it.
   */
  countOwners(restaurantId: string, tx: Prisma.TransactionClient = db) {
    return tx.restaurantMembership.count({
      where: { restaurantId, role: "OWNER" },
    });
  },

  /** Invitations that have not been accepted, newest first. */
  listPendingInvitations(restaurantId: string) {
    return db.restaurantInvitation.findMany({
      where: { restaurantId, acceptedAt: null },
      select: INVITATION_FIELDS,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
  },

  findInvitationByEmail(restaurantId: string, email: string) {
    return db.restaurantInvitation.findUnique({
      where: { restaurantId_email: { restaurantId, email } },
      select: { ...INVITATION_FIELDS, restaurantId: true },
    });
  },

  /**
   * Finds an invitation by the hash of a presented token.
   *
   * Looked up by hash, never by raw token: the raw value is never stored, so
   * there is nothing to compare against even if a query were crafted to try.
   */
  findInvitationByTokenHash(tokenHash: string) {
    return db.restaurantInvitation.findUnique({
      where: { tokenHash },
      select: {
        ...INVITATION_FIELDS,
        restaurantId: true,
        restaurant: { select: { id: true, name: true } },
      },
    });
  },

  /**
   * Creates or replaces the invitation for an address.
   *
   * An upsert against `@@unique([restaurantId, email])`, so re-inviting
   * supersedes rather than accumulating — two live invitations to one address
   * would each be independently acceptable, and cancelling one would leave the
   * other working.
   */
  upsertInvitation(data: {
    restaurantId: string;
    email: string;
    role: RestaurantRole;
    tokenHash: string;
    invitedBy: string;
    expiresAt: Date;
  }) {
    const { restaurantId, email, ...rest } = data;

    return db.restaurantInvitation.upsert({
      where: { restaurantId_email: { restaurantId, email } },
      create: { restaurantId, email, ...rest },
      // A replacement is a fresh invitation: new token, new expiry, and
      // `acceptedAt` cleared so a previously-accepted address can be re-invited
      // after being removed from the team.
      update: { ...rest, acceptedAt: null },
      select: INVITATION_FIELDS,
    });
  },

  deleteInvitation(restaurantId: string, invitationId: string) {
    // `deleteMany` rather than `delete`: the tenant is part of the statement,
    // so an id from another restaurant matches nothing instead of deleting it.
    return db.restaurantInvitation.deleteMany({
      where: { id: invitationId, restaurantId },
    });
  },

  countRecentInvitations(restaurantId: string, since: Date) {
    return db.restaurantInvitation.count({
      where: { restaurantId, createdAt: { gte: since } },
    });
  },
};
