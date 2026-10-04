import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "@repo/database";
import { config } from "../../config.ts";
import { mailer } from "../../shared/email/index.ts";
import { renderPasswordReset, renderVerifyEmail } from "./auth.emails.ts";

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
    minPasswordLength: 12,

    /*
     * ─── Why enforcement is switched on now ─────────────────────────────
     *
     * This was `false` because email delivery did not exist, and requiring
     * verification without it would have locked every account out.
     *
     * Turning it on is safe at this exact moment, and the reason is
     * empirical rather than assumed: there are **zero** accounts. The
     * development database holds no users, nothing is deployed, so there is
     * no population to strand. Every later moment is more expensive, because
     * by then real people would have to be migrated or silently marked
     * verified — and marking an address verified that nobody ever proved
     * they control is exactly the hole verification exists to close.
     */
    requireEmailVerification: true,

    /*
     * A reset link is a bearer credential for an account. An hour is long
     * enough to find the mail and act, short enough that a link left in an
     * inbox, a shared screen or a proxy log stops being useful quickly.
     */
    resetPasswordTokenExpiresIn: 60 * 60,

    /*
     * The property that makes a reset meaningful after a compromise: an
     * attacker holding a live session cookie keeps it otherwise, and the
     * person who just 'recovered' their account still has an intruder in it.
     */
    revokeSessionsOnPasswordReset: true,

    /**
     * Better Auth hands us the raw token; the link is ours to build.
     *
     * It points at the **admin console**, not at this API. A person clicking
     * a reset link expects a page with a password field, and the API has no
     * pages — `BETTER_AUTH_URL` would land them on a JSON document.
     */
    sendResetPassword: async ({ user, token }) => {
      await mailer.send(
        renderPasswordReset({
          to: user.email,
          url: `${config.adminBaseUrl}/reset-password/${encodeURIComponent(token)}`,
        }),
      );
    },
  },

  emailVerification: {
    /* Sent the moment an account is created, since sign-in now requires it. */
    sendOnSignUp: true,

    /*
     * Verifying proves control of the address, which is the same thing
     * signing in proves. Making someone log in again immediately afterwards
     * adds a step without adding a check.
     */
    autoSignInAfterVerification: true,

    /**
     * This link points at the API, not the console: `/api/auth/verify-email`
     * is a GET that verifies and then redirects, so one hop does the work.
     * `callbackURL` is pinned to the console explicitly — left to default it
     * would send a verified user to the API's own root.
     */
    sendVerificationEmail: async ({ user, token }) => {
      const callback = encodeURIComponent(`${config.adminBaseUrl}/verify-email`);
      const url =
        `${config.auth.baseUrl}/api/auth/verify-email` +
        `?token=${encodeURIComponent(token)}&callbackURL=${callback}`;

      await mailer.send(renderVerifyEmail({ to: user.email, url }));
    },
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
