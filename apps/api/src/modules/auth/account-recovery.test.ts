import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@repo/database";
import { app } from "../../app.ts";
import {
  authedRequest,
  cookieHeaderFrom,
  createTestUser,
  lastResetToken,
  lastVerificationToken,
  resetDatabase,
  testMailer,
} from "../../test-support/helpers.ts";

/**
 * Email verification and password recovery.
 *
 * Both are Better Auth's own endpoints; what is tested here is the behaviour
 * this application *configures* — that mail is actually sent, that enforcement
 * is on, that a reset evicts sessions, and above all that neither flow reveals
 * whether an address has an account.
 */

beforeEach(async () => {
  await resetDatabase();
  testMailer().clear();
});

async function json(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Strips the per-request id so two responses can be compared for sameness. */
function withoutRequestId(raw: string): string {
  return raw.replace(/"requestId":"[^"]*"/g, '"requestId":"*"');
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

describe("email verification", () => {
  test("signing up sends a verification email", async () => {
    const email = `verify-${Date.now()}@example.test`;
    await json("/api/auth/sign-up/email", {
      email,
      password: "a-sufficiently-long-password",
      name: "New Person",
    });

    const message = testMailer().lastTo(email);
    expect(message).not.toBeNull();
    expect(message?.subject).toBe("Confirm your email address");
    expect(message?.text).toContain("verify-email?token=");
  });

  /**
   * The enforcement that makes "this account owns this address" true rather
   * than merely claimed — which is what invitation acceptance relies on.
   */
  test("an unverified account cannot sign in", async () => {
    const email = `unverified-${Date.now()}@example.test`;
    const password = "a-sufficiently-long-password";

    await json("/api/auth/sign-up/email", { email, password, name: "Unverified" });
    const signIn = await json("/api/auth/sign-in/email", { email, password });

    expect(signIn.status).toBeGreaterThanOrEqual(400);
    expect(cookieHeaderFrom(signIn)).toBe("");
  });

  test("signing up issues no session until the address is confirmed", async () => {
    const email = `nosession-${Date.now()}@example.test`;
    const signUp = await json("/api/auth/sign-up/email", {
      email,
      password: "a-sufficiently-long-password",
      name: "No Session",
    });

    expect(signUp.status).toBe(200);
    expect(cookieHeaderFrom(signUp)).toBe("");
  });

  test("following the emailed link verifies the account and signs it in", async () => {
    const email = `confirm-${Date.now()}@example.test`;
    await json("/api/auth/sign-up/email", {
      email,
      password: "a-sufficiently-long-password",
      name: "Confirming",
    });

    const token = lastVerificationToken(email);
    expect(token).not.toBeNull();

    const verified = await app.request(
      `/api/auth/verify-email?token=${encodeURIComponent(token!)}`,
    );

    expect([200, 302]).toContain(verified.status);
    // `autoSignInAfterVerification` — proving the address is proving identity.
    expect(cookieHeaderFrom(verified)).not.toBe("");

    const user = await db.user.findUnique({ where: { email } });
    expect(user?.emailVerified).toBe(true);
  });

  test("the verification link points at the console, not the API root", async () => {
    const email = `callback-${Date.now()}@example.test`;
    await json("/api/auth/sign-up/email", {
      email,
      password: "a-sufficiently-long-password",
      name: "Callback",
    });

    // Left to default, a verified user would land on the API's JSON root.
    expect(testMailer().lastTo(email)?.text).toContain("callbackURL=http%3A%2F%2Flocalhost%3A3002");
  });

  test("a garbage verification token is refused", async () => {
    const response = await app.request("/api/auth/verify-email?token=not-a-real-token");
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  test("an already-verified account stays verified", async () => {
    const user = await createTestUser();

    const row = await db.user.findUnique({ where: { id: user.userId } });
    expect(row?.emailVerified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Password recovery
// ---------------------------------------------------------------------------

describe("password recovery", () => {
  test("a known address is emailed a reset link", async () => {
    const user = await createTestUser();
    testMailer().clear();

    const response = await json("/api/auth/request-password-reset", { email: user.email });
    expect(response.status).toBe(200);

    const message = testMailer().lastTo(user.email);
    expect(message?.subject).toBe("Reset your password");
    expect(message?.text).toContain("/reset-password/");
    expect(message?.text).toContain("expires in one hour");
  });

  /**
   * The headline anti-enumeration property, verified rather than assumed.
   *
   * Better Auth 1.6.29 handles this itself — for an unknown address it
   * simulates the token generation and lookup before answering, specifically
   * to flatten the timing difference — but a regression here would silently
   * turn the endpoint into an account oracle, so it is pinned by test.
   */
  test("known and unknown addresses are answered identically", async () => {
    const user = await createTestUser();
    testMailer().clear();

    const known = await json("/api/auth/request-password-reset", { email: user.email });
    const unknown = await json("/api/auth/request-password-reset", {
      email: `definitely-not-registered-${Date.now()}@example.test`,
    });

    expect(unknown.status).toBe(known.status);
    expect(withoutRequestId(await unknown.text())).toBe(withoutRequestId(await known.text()));
  });

  test("no email is sent for an address that does not exist", async () => {
    const stranger = `ghost-${Date.now()}@example.test`;

    await json("/api/auth/request-password-reset", { email: stranger });

    expect(testMailer().lastTo(stranger)).toBeNull();
  });

  test("a reset link actually changes the password", async () => {
    const user = await createTestUser();
    await json("/api/auth/request-password-reset", { email: user.email });
    const token = lastResetToken(user.email);
    expect(token).not.toBeNull();

    const reset = await json("/api/auth/reset-password", {
      token,
      newPassword: "an-entirely-different-password",
    });
    expect(reset.status).toBe(200);

    const oldPassword = await json("/api/auth/sign-in/email", {
      email: user.email,
      password: user.password,
    });
    expect(oldPassword.status).toBeGreaterThanOrEqual(400);

    const newPassword = await json("/api/auth/sign-in/email", {
      email: user.email,
      password: "an-entirely-different-password",
    });
    expect(newPassword.status).toBe(200);
  });

  /**
   * What makes a reset meaningful after a compromise: an attacker holding a
   * live session keeps it otherwise, and the person who just "recovered" their
   * account still has an intruder inside it.
   */
  test("resetting evicts existing sessions", async () => {
    const user = await createTestUser();
    const restaurantResponse = await authedRequest(user, "/admin/restaurants");
    expect(restaurantResponse.status).toBe(200);

    await json("/api/auth/request-password-reset", { email: user.email });
    const token = lastResetToken(user.email);
    await json("/api/auth/reset-password", {
      token,
      newPassword: "an-entirely-different-password",
    });

    // The cookie that worked a moment ago is now worthless.
    const afterReset = await authedRequest(user, "/admin/restaurants");
    expect(afterReset.status).toBe(401);
  });

  test("a reset token cannot be used twice", async () => {
    const user = await createTestUser();
    await json("/api/auth/request-password-reset", { email: user.email });
    const token = lastResetToken(user.email);

    const first = await json("/api/auth/reset-password", {
      token,
      newPassword: "an-entirely-different-password",
    });
    expect(first.status).toBe(200);

    const second = await json("/api/auth/reset-password", {
      token,
      newPassword: "yet-another-password-entirely",
    });
    expect(second.status).toBeGreaterThanOrEqual(400);
  });

  test("an expired reset token is refused", async () => {
    const user = await createTestUser();
    await json("/api/auth/request-password-reset", { email: user.email });
    const token = lastResetToken(user.email);

    // Better Auth keeps reset tokens in the `verifications` table; ageing the
    // row out is how expiry is reached without waiting an hour.
    await db.verification.updateMany({
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const response = await json("/api/auth/reset-password", {
      token,
      newPassword: "an-entirely-different-password",
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  test("a forged reset token is refused", async () => {
    const response = await json("/api/auth/reset-password", {
      token: "a-token-nobody-ever-issued",
      newPassword: "an-entirely-different-password",
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  test("the reset link points at the console, where a password field exists", async () => {
    const user = await createTestUser();
    testMailer().clear();
    await json("/api/auth/request-password-reset", { email: user.email });

    expect(testMailer().lastTo(user.email)?.text).toContain("http://localhost:3002/reset-password/");
  });
});

// ---------------------------------------------------------------------------
// What the emails must never contain
// ---------------------------------------------------------------------------

describe("outgoing mail hygiene", () => {
  test("a reset email carries no password or session material", async () => {
    const user = await createTestUser();
    await json("/api/auth/request-password-reset", { email: user.email });

    const text = testMailer().lastTo(user.email)?.text ?? "";
    expect(text).not.toContain(user.password);
    expect(text.toLowerCase()).not.toContain("session_token");
    expect(text.toLowerCase()).not.toContain("password=");
  });

  test("an invitation email does not disclose whether the address has an account", async () => {
    const owner = await createTestUser();
    const created = await authedRequest(owner, "/admin/restaurants", {
      method: "POST",
      body: JSON.stringify({ name: "Pizza Palace" }),
    });
    const { data } = (await created.json()) as { data: { id: string } };

    const existing = await createTestUser();
    testMailer().clear();

    await authedRequest(owner, `/admin/restaurants/${data.id}/members/invitations`, {
      method: "POST",
      body: JSON.stringify({ email: existing.email }),
    });
    const toExisting = testMailer().lastTo(existing.email)?.text ?? "";

    const strangerEmail = `stranger-${Date.now()}@example.test`;
    await authedRequest(owner, `/admin/restaurants/${data.id}/members/invitations`, {
      method: "POST",
      body: JSON.stringify({ email: strangerEmail }),
    });
    const toStranger = testMailer().lastTo(strangerEmail)?.text ?? "";

    // Identical but for the address and the token — nothing says "you already
    // have an account" or "create one first".
    const normalise = (text: string) =>
      text.replace(/invitations\/[A-Za-z0-9_-]+/, "invitations/TOKEN");

    expect(normalise(toStranger)).toBe(normalise(toExisting));
  });
});
