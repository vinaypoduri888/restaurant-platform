import { z } from "zod";

/**
 * Team membership and invitations.
 *
 * The role vocabulary is duplicated here rather than imported from the Prisma
 * client: `@repo/validation` is consumed by both frontends, and pulling the
 * generated database client into a browser bundle to learn two string literals
 * would drag the whole ORM with it. The enum is two values and changes
 * approximately never; a test asserts the two stay in step.
 */
export const restaurantRoleSchema = z.enum(["OWNER", "STAFF"]);

/**
 * An email address, normalised at the boundary.
 *
 * Lowercased here so every later comparison — the unique index, the acceptance
 * check, the "already a member" check — sees the same string. `trim` first,
 * because a pasted address routinely carries a trailing space and rejecting it
 * would be pedantry rather than safety.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required")
  .max(255)
  .email("Enter a valid email address");

export const inviteMemberSchema = z.object({
  email: emailSchema,
  /*
   * Defaulted rather than required. Staff is the ordinary case, and a form
   * that forces a choice invites an absent-minded OWNER selection — the one
   * value that cannot be undone by the inviter alone.
   */
  role: restaurantRoleSchema.default("STAFF"),
});

export const updateMemberRoleSchema = z.object({
  role: restaurantRoleSchema,
});

/** Addresses one member of one restaurant. */
export const memberParamSchema = z.object({
  restaurantId: z.string().trim().min(1, "restaurantId is required"),
  userId: z.string().trim().min(1, "userId is required"),
});

/** Addresses one invitation of one restaurant. */
export const invitationParamSchema = z.object({
  restaurantId: z.string().trim().min(1, "restaurantId is required"),
  invitationId: z.string().trim().min(1, "invitationId is required"),
});

/**
 * The token from an acceptance URL.
 *
 * Bounded and restricted to the alphabet the generator produces. A token is
 * looked up by hashing it, so a hostile value cannot reach a query — but an
 * unbounded string still reaches the hash function and the logs, and refusing
 * the obviously-wrong shape early keeps both clean.
 */
export const invitationTokenParamSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{16,256}$/, "That invitation link is not valid"),
});

export type RestaurantRoleValue = z.infer<typeof restaurantRoleSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
export type MemberParam = z.infer<typeof memberParamSchema>;
export type InvitationParam = z.infer<typeof invitationParamSchema>;
export type InvitationTokenParam = z.infer<typeof invitationTokenParamSchema>;
