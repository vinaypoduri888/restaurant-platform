import { db, type RestaurantRole } from "@repo/database";
import type { InviteMemberInput } from "@repo/validation/member";
import { config } from "../../config.ts";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
} from "../../shared/errors.ts";
import { mailer, normaliseEmail } from "../../shared/email/index.ts";
import { renderInvitation } from "../auth/auth.emails.ts";
import { membershipService } from "../auth/membership.service.ts";
import { restaurantService } from "../restaurants/restaurant.service.ts";
import { generateInvitationToken, hashInvitationToken } from "./invitation-token.ts";
import { memberRepository } from "./member.repository.ts";

/**
 * Team membership: who may act on a restaurant, and how they come to.
 *
 * ─── The invariant this module exists to protect ────────────────────────────
 *
 * **A restaurant must never reach zero OWNERs.** An ownerless restaurant cannot
 * be deleted, cannot have its team changed, and cannot have its QR code read —
 * every one of those needs an OWNER, so there is no path back. It is not a
 * recoverable mistake, which is why both routes to it (removing the last owner,
 * demoting the last owner) are refused inside the transaction that would
 * otherwise commit it.
 */

/** The window for invitation rate limiting, derived once. */
function rateLimitWindowStart(): Date {
  return new Date(Date.now() - config.invitations.rateLimit.windowMs);
}

export const memberService = {
  /**
   * The team, plus pending invitations.
   *
   * `member:read`, which STAFF also holds — see the capability table for why.
   * Invitations are included because a half-onboarded colleague is part of the
   * answer to "who is on this team"; the token is not, and the repository's
   * projection cannot return it.
   */
  async listForUser(userId: string, restaurantId: string) {
    await membershipService.authorize(userId, restaurantId, "member:read");

    const [members, invitations] = await Promise.all([
      memberRepository.listMembers(restaurantId),
      memberRepository.listPendingInvitations(restaurantId),
    ]);

    return { members, invitations };
  },

  /**
   * Invites an address to join.
   *
   * ─── What this deliberately does not reveal ─────────────────────────────
   *
   * Nothing about whether the address has an account. The response is identical
   * either way, and the email itself is phrased so that a forwarded copy does
   * not disclose it either. An owner who could learn "does this person have an
   * account here" for any address they typed would be an enumeration oracle
   * handed out with every restaurant.
   *
   * The two cases it *does* distinguish are both about this restaurant, which
   * the caller already administers: the address is already a member, or it
   * already holds a live invitation.
   */
  async invite(userId: string, restaurantId: string, input: InviteMemberInput) {
    await membershipService.authorize(userId, restaurantId, "member:manage");

    const email = normaliseEmail(input.email);

    /*
     * Per-restaurant abuse protection. The global auth limiter covers
     * `/api/auth/*` only, and this endpoint is outside it — without this, an
     * authenticated owner could use the platform to send unlimited mail to
     * arbitrary addresses, which is a spam relay with extra steps.
     *
     * Counting rows rather than keeping a counter: the invitations are already
     * being written, the index on `restaurantId` makes it cheap, and unlike the
     * in-process limiter it survives a restart and is shared across instances.
     */
    const recent = await memberRepository.countRecentInvitations(
      restaurantId,
      rateLimitWindowStart(),
    );
    if (recent >= config.invitations.rateLimit.max) {
      throw new TooManyRequestsError(
        "Too many invitations have been sent for this restaurant. Try again later.",
      );
    }

    /*
     * Refusing to invite an existing member is about honesty rather than
     * security: the caller can already see the roster, so this leaks nothing,
     * and silently sending an invitation that acceptance would reject is worse
     * than saying so.
     */
    const existing = await this.findMemberByEmail(restaurantId, email);
    if (existing) {
      throw new ConflictError("That person is already on the team.");
    }

    const token = generateInvitationToken();
    const tokenHash = await hashInvitationToken(token);
    const expiresAt = new Date(Date.now() + config.invitations.ttlHours * 60 * 60 * 1000);

    /*
     * Replaces any previous invitation for this address, so there is never more
     * than one live token per person per restaurant. A superseded token stops
     * working the moment this row is overwritten — which is also what makes
     * "resend" safe: it is the same operation.
     */
    const invitation = await memberRepository.upsertInvitation({
      restaurantId,
      email,
      role: input.role,
      tokenHash,
      invitedBy: userId,
      expiresAt,
    });

    const { restaurant } = await restaurantService.getForUser(userId, restaurantId);
    const inviter = await db.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    /*
     * Sent after the row is committed. The other order — mail first — can
     * deliver a working-looking link whose invitation was never stored, and a
     * person following it would be told it is invalid with no way to tell why.
     *
     * A failure here surfaces to the caller: an invitation nobody received is
     * not a success, and the owner needs to know to try again. The row stays,
     * and re-inviting replaces it.
     */
    await mailer.send(
      renderInvitation({
        to: email,
        url: `${config.adminBaseUrl}/invitations/${encodeURIComponent(token)}`,
        restaurantName: restaurant.name,
        invitedByName: inviter?.name ?? null,
      }),
    );

    // The raw token is returned to nobody — it exists only in the email.
    return invitation;
  },

  /** Withdraws a pending invitation. */
  async cancelInvitation(userId: string, restaurantId: string, invitationId: string) {
    await membershipService.authorize(userId, restaurantId, "member:manage");

    const { count } = await memberRepository.deleteInvitation(restaurantId, invitationId);
    if (count === 0) {
      throw new NotFoundError("That invitation no longer exists.");
    }
  },

  /**
   * Accepts an invitation, creating the membership.
   *
   * ─── Why the email must match the signed-in account ─────────────────────
   *
   * Without that check, an invitation is a transferable membership: anyone the
   * link reaches — a forwarded mail, a shared screen, a mailing list — could
   * join the restaurant as whoever clicked first. Tying acceptance to the
   * invited address means the token alone is not enough; control of that
   * mailbox is also required, which is what the invitation was sent to prove.
   *
   * This is why `requireEmailVerification` matters here too: it is what makes
   * "this account owns this address" true rather than merely claimed.
   */
  async accept(userId: string, userEmail: string, token: string) {
    const tokenHash = await hashInvitationToken(token);
    const invitation = await memberRepository.findInvitationByTokenHash(tokenHash);

    /*
     * One message for every failure: unknown, already used, expired, or
     * addressed to someone else. Distinguishing them would let a holder of a
     * random token learn whether it ever existed, and would tell the wrong
     * person that an invitation to *some* restaurant is in their hands.
     */
    const refuse = () => {
      throw new NotFoundError("That invitation link is not valid or has already been used.");
    };

    if (!invitation) refuse();
    if (invitation!.acceptedAt) refuse();
    if (invitation!.expiresAt.getTime() <= Date.now()) refuse();
    if (invitation!.email !== normaliseEmail(userEmail)) refuse();

    const accepted = invitation!;

    /*
     * Membership and consumption in one transaction. Separately, a crash
     * between them either grants access that no invitation records, or burns an
     * invitation that granted nothing — and the second is unrecoverable for the
     * invitee, since the token is gone.
     */
    await db.$transaction(async (tx) => {
      /*
       * Consume first, and scope the update to rows that are still unaccepted.
       * Two simultaneous acceptances both pass the checks above; exactly one
       * can match `acceptedAt: null` here, so the loser updates nothing and is
       * refused. This is the replay defence, and it is the database's
       * guarantee rather than a time-of-check window.
       */
      const consumed = await tx.restaurantInvitation.updateMany({
        where: { id: accepted.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });

      if (consumed.count === 0) {
        throw new NotFoundError("That invitation link is not valid or has already been used.");
      }

      /*
       * `create`, not `upsert`: a membership already existing means the invite
       * check was raced, and silently overwriting it could *change an existing
       * member's role* — a privilege change that never passed `member:manage`.
       * The unique index turns that into a conflict, which rolls the whole
       * transaction back and leaves the invitation unconsumed.
       */
      await tx.restaurantMembership.create({
        data: {
          userId,
          restaurantId: accepted.restaurantId,
          role: accepted.role,
        },
      });
    });

    return {
      restaurantId: accepted.restaurantId,
      restaurantName: accepted.restaurant.name,
      role: accepted.role,
    };
  },

  /**
   * Changes a member's role.
   *
   * Two refusals that are not obvious:
   *
   * **Nobody may change their own role.** An OWNER demoting themselves is the
   * accidental-lockout case; more importantly, allowing self-change at all
   * means the only thing standing between a STAFF member and OWNER is whether
   * the capability check has a bug. Removing the path removes the class.
   *
   * **The last OWNER may not be demoted** — see the module note.
   */
  async updateRole(
    actorId: string,
    restaurantId: string,
    targetUserId: string,
    role: RestaurantRole,
  ) {
    await membershipService.authorize(actorId, restaurantId, "member:manage");

    if (actorId === targetUserId) {
      throw new ForbiddenError(
        "You cannot change your own role. Ask another owner to do it.",
      );
    }

    await db.$transaction(async (tx) => {
      const current = await tx.restaurantMembership.findUnique({
        where: { userId_restaurantId: { userId: targetUserId, restaurantId } },
        select: { role: true },
      });

      if (!current) {
        throw new NotFoundError("That person is not on this team.");
      }

      if (current.role === role) {
        // Not an error: the requested state is the current state.
        return;
      }

      if (current.role === "OWNER") {
        const owners = await memberRepository.countOwners(restaurantId, tx);
        if (owners <= 1) {
          throw new ConflictError(
            "This is the only owner. Make someone else an owner first.",
          );
        }
      }

      await tx.restaurantMembership.update({
        where: { userId_restaurantId: { userId: targetUserId, restaurantId } },
        data: { role },
      });
    });
  },

  /**
   * Removes someone from the team.
   *
   * Self-removal is permitted — leaving a restaurant you were invited to is
   * legitimate, and forcing someone to ask an owner to let them go is not a
   * security property. The last-owner rule still applies, so the final owner
   * cannot leave either.
   */
  async remove(actorId: string, restaurantId: string, targetUserId: string) {
    await membershipService.authorize(actorId, restaurantId, "member:manage");

    await db.$transaction(async (tx) => {
      const current = await tx.restaurantMembership.findUnique({
        where: { userId_restaurantId: { userId: targetUserId, restaurantId } },
        select: { role: true },
      });

      if (!current) {
        throw new NotFoundError("That person is not on this team.");
      }

      if (current.role === "OWNER") {
        const owners = await memberRepository.countOwners(restaurantId, tx);
        if (owners <= 1) {
          throw new ConflictError(
            "This is the only owner. A restaurant must always have one.",
          );
        }
      }

      // Scoped by tenant in the statement, not by the read above.
      const { count } = await tx.restaurantMembership.deleteMany({
        where: { userId: targetUserId, restaurantId },
      });

      if (count === 0) {
        throw new NotFoundError("That person is not on this team.");
      }
    });
  },

  /**
   * Finds a member of this restaurant by address.
   *
   * Scoped to one restaurant on purpose. This is not a user lookup: it answers
   * "is this address on *my* team", which the caller can already see, and it
   * cannot answer "does this address have an account".
   */
  async findMemberByEmail(restaurantId: string, email: string) {
    const match = await db.restaurantMembership.findFirst({
      where: { restaurantId, user: { email: normaliseEmail(email) } },
      select: { userId: true, role: true },
    });

    return match;
  },

  /**
   * Describes an invitation to the person holding the token.
   *
   * Used by the acceptance page so it can say which restaurant is inviting
   * them before they sign in. Returns the restaurant's name and the invited
   * address — both of which the holder already has in the email — and nothing
   * about accounts or the team.
   */
  async describe(token: string) {
    const tokenHash = await hashInvitationToken(token);
    const invitation = await memberRepository.findInvitationByTokenHash(tokenHash);

    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      throw new NotFoundError("That invitation link is not valid or has already been used.");
    }

    return {
      email: invitation.email,
      role: invitation.role,
      restaurantName: invitation.restaurant.name,
      expiresAt: invitation.expiresAt,
    };
  },
};

/** Guards against a role value arriving from somewhere unvalidated. */
export function assertKnownRole(role: string): asserts role is RestaurantRole {
  if (role !== "OWNER" && role !== "STAFF") {
    throw new BadRequestError("Unknown role");
  }
}
