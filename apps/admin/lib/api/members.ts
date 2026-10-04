import { cache } from "react";
import { apiRequest } from "./client";
import type { MembershipRole } from "./restaurants";

/**
 * The team, as the admin API returns it.
 *
 * Verified against the live endpoint. Note what is absent: no invitation token
 * anywhere. The API's projection cannot select it, so there is nothing for this
 * console to accidentally render into a page or a log.
 */
export interface TeamMember {
  userId: string;
  role: MembershipRole;
  createdAt: string;
  user: { id: string; name: string; email: string };
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: MembershipRole;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  /**
   * Whether the link has already lapsed.
   *
   * Derived here, in the data layer, rather than in a component. Reading the
   * clock while rendering is impure: the server and the browser can land on
   * different answers either side of the expiry instant, which is a hydration
   * mismatch on exactly the row the reader is looking at. Deciding it once,
   * at fetch time, gives every row one consistent answer.
   */
  hasExpired: boolean;
}

export interface Team {
  members: TeamMember[];
  invitations: PendingInvitation[];
}

/** Exactly what the API returns, before `hasExpired` is derived. */
interface ApiTeam {
  members: TeamMember[];
  invitations: Omit<PendingInvitation, "hasExpired">[];
}

/** What the acceptance page may show before anyone commits to joining. */
export interface InvitationSummary {
  email: string;
  role: MembershipRole;
  restaurantName: string;
  expiresAt: string;
}

export interface AcceptedInvitation {
  restaurantId: string;
  restaurantName: string;
  role: MembershipRole;
}

function teamPath(restaurantId: string): string {
  return `/admin/restaurants/${encodeURIComponent(restaurantId)}/members`;
}

/**
 * Fetches the team.
 *
 * `cache`d so a page and its layout share one request, like every other read
 * here. Throws `ForbiddenError` for a non-member; the page maps that.
 */
export const getTeam = cache(async (restaurantId: string): Promise<Team> => {
  const team = await apiRequest<ApiTeam>(teamPath(restaurantId));
  const now = Date.now();

  return {
    ...team,
    invitations: team.invitations.map((invitation) => ({
      ...invitation,
      hasExpired: new Date(invitation.expiresAt).getTime() <= now,
    })),
  };
});

export function inviteMember(
  restaurantId: string,
  input: { email: string; role: MembershipRole },
): Promise<PendingInvitation> {
  return apiRequest<PendingInvitation>(`${teamPath(restaurantId)}/invitations`, {
    method: "POST",
    body: input,
  });
}

export function cancelInvitation(restaurantId: string, invitationId: string): Promise<void> {
  return apiRequest<void>(
    `${teamPath(restaurantId)}/invitations/${encodeURIComponent(invitationId)}`,
    { method: "DELETE" },
  );
}

export function updateMemberRole(
  restaurantId: string,
  userId: string,
  role: MembershipRole,
): Promise<void> {
  return apiRequest<void>(`${teamPath(restaurantId)}/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: { role },
  });
}

export function removeMember(restaurantId: string, userId: string): Promise<void> {
  return apiRequest<void>(`${teamPath(restaurantId)}/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

/** Describes an invitation to whoever holds the token. */
export const describeInvitation = cache(
  async (token: string): Promise<InvitationSummary> =>
    apiRequest<InvitationSummary>(`/invitations/${encodeURIComponent(token)}`),
);

export function acceptInvitation(token: string): Promise<AcceptedInvitation> {
  return apiRequest<AcceptedInvitation>(`/invitations/${encodeURIComponent(token)}/accept`, {
    method: "POST",
  });
}

/**
 * Whether a role may change the team.
 *
 * Mirrors `member:manage`, which is OWNER only. STAFF holds `member:read`, so
 * they see the roster but are offered no controls.
 *
 * **Not a security control** — it decides what to render, so staff are not
 * shown buttons that will always refuse. The API re-authorizes every mutation,
 * and the forms still handle a 403: a role can be revoked between the page
 * rendering and the button being pressed.
 */
export function canManageTeam(role: MembershipRole): boolean {
  return role === "OWNER";
}

/**
 * Whether this member is the last owner.
 *
 * Used to explain, before anyone tries, why the final owner cannot be removed
 * or demoted — the backend refuses it either way, but a disabled control with a
 * reason beats a button that returns an error.
 */
export function isLastOwner(members: TeamMember[], userId: string): boolean {
  const owners = members.filter((member) => member.role === "OWNER");

  return owners.length === 1 && owners[0]?.userId === userId;
}
