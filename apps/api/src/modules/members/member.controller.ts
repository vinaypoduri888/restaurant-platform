import type { Context } from "hono";
import type { RestaurantScopeParam } from "@repo/validation/category";
import type {
  InvitationParam,
  InvitationTokenParam,
  InviteMemberInput,
  MemberParam,
  UpdateMemberRoleInput,
} from "@repo/validation/member";
import type { AppEnv } from "../../shared/app-env.ts";
import { created, noContent, ok } from "../../shared/http.ts";
import { getValidated } from "../../shared/validated.ts";
import { memberService } from "./member.service.ts";

type Ctx = Context<AppEnv>;

export async function list(c: Ctx) {
  const { restaurantId } = getValidated<RestaurantScopeParam>(c, "param");
  const team = await memberService.listForUser(c.get("user").id, restaurantId);

  return ok(c, team);
}

export async function invite(c: Ctx) {
  const { restaurantId } = getValidated<RestaurantScopeParam>(c, "param");
  const body = getValidated<InviteMemberInput>(c, "json");

  // The tenant comes from the authorized URL scope. A `restaurantId` in the
  // body would be ignored — it is not part of the validated shape at all.
  const invitation = await memberService.invite(c.get("user").id, restaurantId, body);

  return created(c, invitation);
}

export async function cancelInvitation(c: Ctx) {
  const { restaurantId, invitationId } = getValidated<InvitationParam>(c, "param");
  await memberService.cancelInvitation(c.get("user").id, restaurantId, invitationId);

  return noContent(c);
}

export async function updateRole(c: Ctx) {
  const { restaurantId, userId } = getValidated<MemberParam>(c, "param");
  const { role } = getValidated<UpdateMemberRoleInput>(c, "json");

  await memberService.updateRole(c.get("user").id, restaurantId, userId, role);

  return noContent(c);
}

export async function remove(c: Ctx) {
  const { restaurantId, userId } = getValidated<MemberParam>(c, "param");
  await memberService.remove(c.get("user").id, restaurantId, userId);

  return noContent(c);
}

/**
 * Describes an invitation to whoever holds the token.
 *
 * Authenticated, like acceptance: the page behind it is in the console, and
 * leaving it open would let anyone who found a link learn a restaurant's name
 * and an invited address without ever having an account.
 */
export async function describeInvitation(c: Ctx) {
  const { token } = getValidated<InvitationTokenParam>(c, "param");

  return ok(c, await memberService.describe(token));
}

/**
 * Accepts an invitation.
 *
 * Deliberately **not** scoped by restaurant in the URL. The caller is not yet a
 * member, so there is no membership to authorize against — the token carries
 * the scope, and the service checks that the signed-in account owns the invited
 * address before granting anything.
 */
export async function acceptInvitation(c: Ctx) {
  const { token } = getValidated<InvitationTokenParam>(c, "param");
  const user = c.get("user");

  const result = await memberService.accept(user.id, user.email, token);

  return ok(c, result);
}
