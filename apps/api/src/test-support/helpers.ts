import { db } from "@repo/database";
import { ConsoleMailer } from "../shared/email/console-mailer.ts";
import { mailer } from "../shared/email/index.ts";
import { app } from "../app.ts";
import { config } from "../config.ts";

/**
 * Hard safety interlock.
 *
 * `resetDatabase` truncates every table. If the test process were ever pointed
 * at the development (or any real) database, that would destroy data silently.
 * Refusing to run unless the target database name ends in `_test` makes such a
 * misconfiguration a loud failure instead.
 */
function assertSafeTestDatabase(): void {
  const databaseName = config.databaseUrl.split("/").pop()?.split("?")[0] ?? "";

  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run destructive test helpers against database "${databaseName}". ` +
        `Tests must target a database whose name ends in "_test". ` +
        `Check apps/api/.env.test and that NODE_ENV=test.`,
    );
  }
}

/** Clears all data between tests, leaving the schema intact. */
export async function resetDatabase(): Promise<void> {
  assertSafeTestDatabase();

  // Order matters only in the absence of CASCADE; TRUNCATE ... CASCADE handles
  // the foreign keys, and RESTART IDENTITY keeps sequences predictable.
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE "restaurant_invitations", "restaurant_slugs", "restaurant_media", "operating_hours", "menu_items", "categories", "restaurant_memberships", "sessions", "accounts", "verifications", "users", "restaurants" RESTART IDENTITY CASCADE`,
  );
}

export interface TestUser {
  email: string;
  /** The password it was created with, for sign-in and reset tests. */
  password: string;
  userId: string;
  /** Value to send as the `Cookie` request header. */
  cookie: string;
}

let userCounter = 0;

/**
 * Registers a user through the real Better Auth endpoint and returns their
 * session cookie. Deliberately not a direct database insert — this exercises
 * the same password hashing and session creation path production uses.
 */
export async function createTestUser(
  overrides: { password?: string; verify?: boolean } = {},
): Promise<TestUser> {
  userCounter += 1;
  const email = `test-user-${userCounter}-${Date.now()}@example.test`;
  const password = overrides.password ?? "a-sufficiently-long-password";

  const signUp = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: `Test User ${userCounter}` }),
  });

  if (signUp.status !== 200) {
    throw new Error(`Test user sign-up failed (${signUp.status}): ${await signUp.text()}`);
  }

  const { user } = (await signUp.json()) as { user: { id: string } };

  /*
   * Sign-up no longer returns a session: `requireEmailVerification` is on, so
   * an unverified account cannot act.
   *
   * The helper therefore completes the real verification flow rather than
   * marking the row verified behind the API's back. That costs one extra
   * request per test user and buys something worth having: every test in the
   * suite exercises the production path, so a break in verification fails
   * loudly everywhere instead of hiding behind a shortcut only tests use.
   */
  const cookie = overrides.verify === false ? "" : await verifyAndSignIn(email);

  return { email, password, userId: user.id, cookie };
}

/**
 * Walks the verification link that was just emailed and returns the session.
 *
 * `autoSignInAfterVerification` means verifying issues a session, so this is
 * one request rather than verify-then-sign-in.
 */
async function verifyAndSignIn(email: string): Promise<string> {
  const token = lastVerificationToken(email);
  if (!token) {
    throw new Error(`No verification email was sent to ${email}`);
  }

  const verified = await app.request(
    `/api/auth/verify-email?token=${encodeURIComponent(token)}`,
  );

  // 302 is the success path: it verifies, then redirects to `callbackURL`.
  if (verified.status !== 200 && verified.status !== 302) {
    throw new Error(
      `Verifying ${email} failed (${verified.status}): ${await verified.text()}`,
    );
  }

  const cookie = cookieHeaderFrom(verified);
  if (!cookie) {
    throw new Error(`Verification of ${email} returned no session cookie`);
  }

  return cookie;
}

/** Reduces `name=value; Path=/; HttpOnly; ...` to the `name=value` pairs. */
export function cookieHeaderFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) return "";

  return setCookie
    .split(",")
    .map((part) => part.split(";")[0]?.trim())
    .filter((pair): pair is string => Boolean(pair))
    .filter((pair) => pair.includes("=") && !pair.endsWith("="))
    .join("; ");
}

/** Issues a request authenticated as `user`. */
export async function authedRequest(
  user: TestUser,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
      Cookie: user.cookie,
    },
  });
}

/**
 * Grants `user` a membership on `restaurantId` with the given role.
 *
 * Written directly to the database because no member-management API exists
 * yet — that is the only way to exercise the STAFF policy today.
 */
export async function grantMembership(
  user: TestUser,
  restaurantId: string,
  role: "OWNER" | "STAFF",
): Promise<void> {
  await db.restaurantMembership.create({
    data: { userId: user.userId, restaurantId, role },
  });
}

/** Creates a restaurant owned by `user` and returns the created record. */
export async function createRestaurantAs(
  user: TestUser,
  input: Record<string, unknown>,
): Promise<{ id: string; slug: string; name: string }> {
  const response = await authedRequest(user, "/admin/restaurants", {
    method: "POST",
    body: JSON.stringify(input),
  });

  if (response.status !== 201) {
    throw new Error(`Restaurant creation failed (${response.status}): ${await response.text()}`);
  }

  const body = (await response.json()) as { data: { id: string; slug: string; name: string } };
  return body.data;
}

/** Creates a menu category through the real admin API. */
export async function createCategoryAs(
  user: TestUser,
  restaurantId: string,
  input: Record<string, unknown>,
): Promise<{ id: string; name: string; slug: string; position: number }> {
  const response = await authedRequest(
    user,
    `/admin/restaurants/${restaurantId}/categories`,
    { method: "POST", body: JSON.stringify(input) },
  );

  if (response.status !== 201) {
    throw new Error(`Category creation failed (${response.status}): ${await response.text()}`);
  }

  const body = (await response.json()) as {
    data: { id: string; name: string; slug: string; position: number };
  };
  return body.data;
}

/** Creates a menu item through the real admin API. */
export async function createMenuItemAs(
  user: TestUser,
  restaurantId: string,
  input: Record<string, unknown>,
): Promise<{ id: string; name: string; priceMinor: number; position: number; categoryId: string }> {
  const response = await authedRequest(
    user,
    `/admin/restaurants/${restaurantId}/menu-items`,
    { method: "POST", body: JSON.stringify(input) },
  );

  if (response.status !== 201) {
    throw new Error(`Menu item creation failed (${response.status}): ${await response.text()}`);
  }

  const body = (await response.json()) as {
    data: { id: string; name: string; priceMinor: number; position: number; categoryId: string };
  };
  return body.data;
}

/**
 * The console mailer the application is running with.
 *
 * Tests read its outbox to recover verification, reset and invitation tokens —
 * the same way a person reads them out of their inbox. Nothing is mocked: the
 * message under inspection is the one the application actually produced.
 *
 * `EMAIL_DRIVER` has no other value in the test environment, so the cast is
 * safe; it is asserted rather than assumed on first use.
 */
export function testMailer(): ConsoleMailer {
  if (!(mailer instanceof ConsoleMailer)) {
    throw new Error(
      "Tests require EMAIL_DRIVER=console so that emailed tokens can be read back.",
    );
  }

  return mailer;
}

/** Pulls a `token=...` value out of the most recent mail to an address. */
export function lastTokenFor(email: string, pattern: RegExp): string | null {
  const message = testMailer().lastTo(email);
  if (!message) return null;

  return pattern.exec(message.text)?.[1] ?? null;
}

/** The verification token from the most recent verification email. */
export function lastVerificationToken(email: string): string | null {
  return lastTokenFor(email, /verify-email\?token=([^&\s]+)/);
}

/** The reset token from the most recent password-reset email. */
export function lastResetToken(email: string): string | null {
  return lastTokenFor(email, /reset-password\/([^\s]+)/);
}

/** The invitation token from the most recent invitation email. */
export function lastInvitationToken(email: string): string | null {
  return lastTokenFor(email, /invitations\/([^\s]+)/);
}
