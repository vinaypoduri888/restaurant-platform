import { db } from "@repo/database";
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
    `TRUNCATE TABLE "restaurant_memberships", "sessions", "accounts", "verifications", "users", "restaurants" RESTART IDENTITY CASCADE`,
  );
}

export interface TestUser {
  email: string;
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
export async function createTestUser(overrides: { password?: string } = {}): Promise<TestUser> {
  userCounter += 1;
  const email = `test-user-${userCounter}-${Date.now()}@example.test`;
  const password = overrides.password ?? "a-sufficiently-long-password";

  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: `Test User ${userCounter}` }),
  });

  if (response.status !== 200) {
    throw new Error(`Test user sign-up failed (${response.status}): ${await response.text()}`);
  }

  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Sign-up succeeded but returned no session cookie");
  }

  // Reduce `name=value; Path=/; HttpOnly; ...` to the `name=value` pair.
  const cookie = setCookie
    .split(",")
    .map((part) => part.split(";")[0]?.trim())
    .filter((pair): pair is string => Boolean(pair))
    .join("; ");

  const body = (await response.json()) as { user: { id: string } };

  return { email, userId: body.user.id, cookie };
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
