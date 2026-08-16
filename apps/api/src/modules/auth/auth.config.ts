import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "@repo/database";
import { config } from "../../config.ts";

/**
 * Better Auth instance — the authoritative source for authentication.
 *
 * Why a library rather than hand-rolled auth: password hashing, session
 * lifecycle, cookie flags, and CSRF/origin checks are security-critical and
 * easy to get subtly wrong. Better Auth is TypeScript-first, framework
 * agnostic, and has a first-party Prisma adapter, so it fits the existing
 * stack without displacing anything.
 *
 * Scope note: Better Auth handles *authentication only* here. Authorization —
 * which restaurants a user may act on — is modelled by our own
 * `RestaurantMembership` table rather than Better Auth's generic organization
 * plugin, so the domain keeps its own vocabulary and we do not pull in
 * invitation/team tables the product does not need yet.
 */
export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),

  secret: config.auth.secret,
  baseURL: config.auth.baseUrl,

  emailAndPassword: {
    enabled: true,
    // Email delivery is not wired up yet, so requiring verification would lock
    // every new account out. Revisit when transactional email exists.
    requireEmailVerification: false,
    minPasswordLength: 12,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh the expiry at most once a day
  },

  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      // Browsers reject `Secure` cookies over plain http://localhost, so this
      // must track the environment rather than being hard-coded on.
      secure: config.isProduction,
    },
  },

  // Only these origins may drive authentication flows.
  trustedOrigins: config.corsOrigins,
});

export type AuthSession = typeof auth.$Infer.Session;
