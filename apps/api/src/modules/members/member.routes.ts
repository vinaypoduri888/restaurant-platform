import { Hono } from "hono";
import { restaurantScopeParamSchema } from "@repo/validation/category";
import {
  invitationParamSchema,
  invitationTokenParamSchema,
  inviteMemberSchema,
  memberParamSchema,
  updateMemberRoleSchema,
} from "@repo/validation/member";
import { requireAuth } from "../../middleware/auth.ts";
import type { AppEnv } from "../../shared/app-env.ts";
import { validate } from "../../shared/validate.ts";
import * as memberController from "./member.controller.ts";

/**
 * Team routes, mounted at `/admin/restaurants/:restaurantId/members`.
 *
 * The restaurant is in the path, so every route validates and authorizes the
 * same tenant, and a `restaurantId` in a request body has nowhere to take
 * effect — it is not part of any validated shape here.
 *
 * Reads need `member:read` (STAFF and OWNER); every mutation needs
 * `member:manage` (OWNER only). That split is enforced in the service, not
 * here, so it holds regardless of how a route is reached.
 */
export const adminMemberRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", validate("param", restaurantScopeParamSchema), memberController.list)
  .post(
    "/invitations",
    validate("param", restaurantScopeParamSchema),
    validate("json", inviteMemberSchema),
    memberController.invite,
  )
  .delete(
    "/invitations/:invitationId",
    validate("param", invitationParamSchema),
    memberController.cancelInvitation,
  )
  .patch(
    "/:userId",
    validate("param", memberParamSchema),
    validate("json", updateMemberRoleSchema),
    memberController.updateRole,
  )
  .delete("/:userId", validate("param", memberParamSchema), memberController.remove);

/**
 * Invitation acceptance, mounted at `/invitations`.
 *
 * Deliberately outside `/admin/restaurants/:restaurantId`: the caller is not a
 * member yet, so there is no membership to authorize against and no tenant to
 * put in the path. The token carries the scope.
 *
 * Still behind `requireAuth` — accepting creates a membership, which needs an
 * account to attach it to, and the service checks that account owns the invited
 * address. An anonymous caller gets 401 and the console sends them to sign in
 * or register, returning here afterwards.
 */
export const invitationRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get(
    "/:token",
    validate("param", invitationTokenParamSchema),
    memberController.describeInvitation,
  )
  .post(
    "/:token/accept",
    validate("param", invitationTokenParamSchema),
    memberController.acceptInvitation,
  );
