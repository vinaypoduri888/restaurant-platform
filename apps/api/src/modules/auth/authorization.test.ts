import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@repo/database";
import { app } from "../../app.ts";
import {
  authedRequest,
  createRestaurantAs,
  createTestUser,
  grantMembership,
  resetDatabase,
} from "../../test-support/helpers.ts";

beforeEach(async () => {
  await resetDatabase();
});

/**
 * The STAFF role had no coverage before this file: every existing test acted
 * as an OWNER, so the half of the capability policy that actually restricts
 * anything was never exercised.
 */
describe("STAFF role policy", () => {
  async function ownerWithStaff() {
    const [owner, staff] = await Promise.all([createTestUser(), createTestUser()]);
    const restaurant = await createRestaurantAs(owner, { name: "Shared Restaurant" });
    await grantMembership(staff, restaurant.id, "STAFF");
    return { owner, staff, restaurant };
  }

  test("STAFF may read the restaurant they belong to", async () => {
    const { staff, restaurant } = await ownerWithStaff();

    const response = await authedRequest(staff, `/admin/restaurants/${restaurant.id}`);
    expect(response.status).toBe(200);
  });

  test("STAFF may update the restaurant they belong to", async () => {
    const { staff, restaurant } = await ownerWithStaff();

    const response = await authedRequest(staff, `/admin/restaurants/${restaurant.id}`, {
      method: "PATCH",
      body: JSON.stringify({ city: "Updated by staff" }),
    });

    expect(response.status).toBe(200);
  });

  test("STAFF may NOT delete the restaurant", async () => {
    const { staff, restaurant } = await ownerWithStaff();

    const response = await authedRequest(staff, `/admin/restaurants/${restaurant.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    // The record must survive the refused request.
    expect(await db.restaurant.count({ where: { id: restaurant.id } })).toBe(1);
  });

  test("OWNER may delete the restaurant", async () => {
    const { owner, restaurant } = await ownerWithStaff();

    const response = await authedRequest(owner, `/admin/restaurants/${restaurant.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
  });

  test("STAFF membership does not grant access to other restaurants", async () => {
    const { staff } = await ownerWithStaff();
    const outsider = await createTestUser();
    const other = await createRestaurantAs(outsider, { name: "Unrelated Restaurant" });

    const response = await authedRequest(staff, `/admin/restaurants/${other.id}`);
    expect(response.status).toBe(403);
  });
});

/**
 * Privilege escalation through the request body. Zod strips unknown keys, but
 * that is a property worth pinning down: a future schema switched to
 * `passthrough()` would silently open all of these.
 */
describe("mass assignment protection", () => {
  test("a STAFF member cannot promote themselves via the update payload", async () => {
    const [owner, staff] = await Promise.all([createTestUser(), createTestUser()]);
    const restaurant = await createRestaurantAs(owner, { name: "Target Restaurant" });
    await grantMembership(staff, restaurant.id, "STAFF");

    await authedRequest(staff, `/admin/restaurants/${restaurant.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed", role: "OWNER", ownerId: staff.userId }),
    });

    const membership = await db.restaurantMembership.findUnique({
      where: { userId_restaurantId: { userId: staff.userId, restaurantId: restaurant.id } },
      select: { role: true },
    });
    expect(membership?.role).toBe("STAFF");

    // And the escalation attempt must not have granted delete either.
    const deleteAttempt = await authedRequest(staff, `/admin/restaurants/${restaurant.id}`, {
      method: "DELETE",
    });
    expect(deleteAttempt.status).toBe(403);
  });

  test("client-supplied id, timestamps, and isActive are ignored on create", async () => {
    const user = await createTestUser();

    const response = await authedRequest(user, "/admin/restaurants", {
      method: "POST",
      body: JSON.stringify({
        name: "Injected Restaurant",
        id: "attacker-chosen-id",
        isActive: false,
        createdAt: "1999-01-01T00:00:00.000Z",
      }),
    });
    const body = (await response.json()) as {
      data: { id: string; isActive: boolean; createdAt: string };
    };

    expect(response.status).toBe(201);
    expect(body.data.id).not.toBe("attacker-chosen-id");
    // isActive is not part of the create schema, so the server default wins.
    expect(body.data.isActive).toBe(true);
    expect(new Date(body.data.createdAt).getFullYear()).toBeGreaterThan(2000);
  });

  test("writes target the id in the URL, not one smuggled in the body", async () => {
    const [ownerA, ownerB] = await Promise.all([createTestUser(), createTestUser()]);
    const restaurantA = await createRestaurantAs(ownerA, { name: "Restaurant A" });
    const restaurantB = await createRestaurantAs(ownerB, { name: "Restaurant B" });

    await authedRequest(ownerA, `/admin/restaurants/${restaurantA.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed A", id: restaurantB.id }),
    });

    const b = await db.restaurant.findUnique({ where: { id: restaurantB.id } });
    expect(b?.name).toBe("Restaurant B");
  });
});

describe("session lifecycle", () => {
  test("a session is invalidated server-side on sign-out", async () => {
    const user = await createTestUser();

    expect((await authedRequest(user, "/admin/restaurants")).status).toBe(200);

    // Better Auth requires a trusted Origin on state-changing auth calls
    // (its CSRF protection), so the sign-out must supply one.
    const signOut = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        Cookie: user.cookie,
      },
      body: "{}",
    });
    expect(signOut.status).toBe(200);

    // Replaying the same cookie must now fail — proving the session was
    // destroyed on the server, not merely cleared in the client.
    const replay = await app.request("/admin/restaurants", {
      headers: { Cookie: user.cookie },
    });
    expect(replay.status).toBe(401);
  });

  test("sign-in requires valid credentials", async () => {
    const password = "a-sufficiently-long-password";
    const user = await createTestUser({ password });

    const wrong = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ email: user.email, password: "not-the-right-password" }),
    });
    expect(wrong.status).toBe(401);

    const right = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ email: user.email, password }),
    });
    expect(right.status).toBe(200);
  });

  // NOTE: Better Auth's cross-origin (CSRF) rejection is deliberately NOT
  // asserted here. In-process `app.request()` produces a synthetic request
  // whose host differs from the configured `baseURL`, so the origin check does
  // not behave as it does over the wire and the assertion would be misleading.
  // Verified manually over real HTTP instead: a sign-in with valid credentials
  // and `Origin: http://evil.example.com` returns 403 INVALID_ORIGIN, while the
  // same request from a trusted origin returns 200. Re-check that by hand if
  // the auth configuration changes.
});
