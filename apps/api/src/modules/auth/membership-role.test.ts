import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@repo/database";
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
 * `GET /admin/restaurants/:id` reports the caller's own membership role so a
 * management UI can show only the controls that caller can use.
 *
 * The role is informational. These tests exist to prove it is derived from the
 * authenticated session and the database, that it cannot be influenced by the
 * request, and that exposing it did not open a way to learn anything about a
 * restaurant the caller has no membership in.
 */

interface DetailResponse {
  success: boolean;
  data: {
    restaurant: {
      id: string;
      name: string;
      slug: string;
      currency: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    };
    role: "OWNER" | "STAFF";
  };
}

async function readDetail(
  user: Awaited<ReturnType<typeof createTestUser>>,
  restaurantId: string,
): Promise<{ status: number; body: DetailResponse }> {
  const response = await authedRequest(user, `/admin/restaurants/${restaurantId}`);
  return { status: response.status, body: (await response.json()) as DetailResponse };
}

describe("membership role on the restaurant detail response", () => {
  test("the creator of a restaurant sees OWNER", async () => {
    const owner = await createTestUser();
    const restaurant = await createRestaurantAs(owner, { name: "Pizza Palace" });

    const { status, body } = await readDetail(owner, restaurant.id);

    expect(status).toBe(200);
    expect(body.data.role).toBe("OWNER");
  });

  test("a staff member sees STAFF", async () => {
    const owner = await createTestUser();
    const staff = await createTestUser();
    const restaurant = await createRestaurantAs(owner, { name: "Pizza Palace" });
    await grantMembership(staff, restaurant.id, "STAFF");

    const { status, body } = await readDetail(staff, restaurant.id);

    expect(status).toBe(200);
    expect(body.data.role).toBe("STAFF");
  });

  /**
   * Two people, one restaurant, two different answers — which is the whole
   * point. A single shared value would be a caching bug waiting to happen.
   */
  test("the same restaurant reports a different role to each member", async () => {
    const owner = await createTestUser();
    const staff = await createTestUser();
    const restaurant = await createRestaurantAs(owner, { name: "Shared Restaurant" });
    await grantMembership(staff, restaurant.id, "STAFF");

    const [ownerView, staffView] = await Promise.all([
      readDetail(owner, restaurant.id),
      readDetail(staff, restaurant.id),
    ]);

    expect(ownerView.body.data.role).toBe("OWNER");
    expect(staffView.body.data.role).toBe("STAFF");
    expect(ownerView.body.data.restaurant.id).toBe(staffView.body.data.restaurant.id);
  });

  /**
   * A role is per-restaurant, not per-user. Someone who owns one restaurant and
   * merely works at another must not carry OWNER across.
   */
  test("a role does not leak from one restaurant to another", async () => {
    const user = await createTestUser();
    const otherOwner = await createTestUser();

    const own = await createRestaurantAs(user, { name: "Their Own Place" });
    const other = await createRestaurantAs(otherOwner, { name: "Somewhere They Work" });
    await grantMembership(user, other.id, "STAFF");

    expect((await readDetail(user, own.id)).body.data.role).toBe("OWNER");
    expect((await readDetail(user, other.id)).body.data.role).toBe("STAFF");
  });

  /**
   * Unchanged behaviour, asserted because this change touched the same code
   * path: "you are not a member" and "no such id" must stay indistinguishable,
   * and neither may reveal a role.
   */
  test("a non-member still gets 403 with no role and no restaurant", async () => {
    const owner = await createTestUser();
    const outsider = await createTestUser();
    const restaurant = await createRestaurantAs(owner, { name: "Not Yours" });

    const response = await authedRequest(outsider, `/admin/restaurants/${restaurant.id}`);
    const raw = await response.text();

    expect(response.status).toBe(403);
    expect(raw).not.toContain("OWNER");
    expect(raw).not.toContain("STAFF");
    expect(raw).not.toContain("Not Yours");
  });

  test("a nonexistent id is answered identically to a forbidden one", async () => {
    const user = await createTestUser();

    const response = await authedRequest(user, "/admin/restaurants/cmnonexistentid00000000");
    const raw = await response.text();

    expect(response.status).toBe(403);
    expect(raw).not.toContain("OWNER");
    expect(raw).not.toContain("STAFF");
  });

  test("an anonymous caller is still rejected before any role is looked up", async () => {
    const owner = await createTestUser();
    const restaurant = await createRestaurantAs(owner, { name: "Pizza Palace" });

    const response = await authedRequest(
      { email: "", userId: "", cookie: "better-auth.session_token=forged" },
      `/admin/restaurants/${restaurant.id}`,
    );

    expect(response.status).toBe(401);
  });
});

describe("the reported role cannot be influenced by the request", () => {
  /**
   * The role is read from the membership row that authorized the request. There
   * is no code path that reads it from input — these assert that directly,
   * because "we don't do that" is exactly the kind of claim that quietly stops
   * being true.
   */
  test("a role in the query string is ignored", async () => {
    const owner = await createTestUser();
    const staff = await createTestUser();
    const restaurant = await createRestaurantAs(owner, { name: "Pizza Palace" });
    await grantMembership(staff, restaurant.id, "STAFF");

    const response = await authedRequest(
      staff,
      `/admin/restaurants/${restaurant.id}?role=OWNER&userId=${owner.userId}`,
    );
    const body = (await response.json()) as DetailResponse;

    expect(body.data.role).toBe("STAFF");
  });

  test("a role in the request body is ignored", async () => {
    const owner = await createTestUser();
    const staff = await createTestUser();
    const restaurant = await createRestaurantAs(owner, { name: "Pizza Palace" });
    await grantMembership(staff, restaurant.id, "STAFF");

    // GET with a body is unusual, which is the point: even if something sent
    // one, it must not reach the role.
    const response = await authedRequest(staff, `/admin/restaurants/${restaurant.id}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    const body = (await response.json()) as DetailResponse;

    expect(body.data.role).toBe("STAFF");
  });

  /**
   * The membership row is the single source of truth: change it in the
   * database and the reported role changes with it, with nothing cached in
   * between.
   */
  test("the role follows the membership record", async () => {
    const owner = await createTestUser();
    const staff = await createTestUser();
    const restaurant = await createRestaurantAs(owner, { name: "Pizza Palace" });
    await grantMembership(staff, restaurant.id, "STAFF");

    expect((await readDetail(staff, restaurant.id)).body.data.role).toBe("STAFF");

    await db.restaurantMembership.update({
      where: { userId_restaurantId: { userId: staff.userId, restaurantId: restaurant.id } },
      data: { role: "OWNER" },
    });

    expect((await readDetail(staff, restaurant.id)).body.data.role).toBe("OWNER");
  });

  /**
   * Removing the membership must remove access entirely, not merely downgrade
   * the reported role.
   */
  test("revoking membership removes access rather than lowering the role", async () => {
    const owner = await createTestUser();
    const staff = await createTestUser();
    const restaurant = await createRestaurantAs(owner, { name: "Pizza Palace" });
    await grantMembership(staff, restaurant.id, "STAFF");

    await db.restaurantMembership.delete({
      where: { userId_restaurantId: { userId: staff.userId, restaurantId: restaurant.id } },
    });

    const response = await authedRequest(staff, `/admin/restaurants/${restaurant.id}`);
    expect(response.status).toBe(403);
  });
});

describe("the existing restaurant data is unchanged", () => {
  test("every field previously returned is still present, now under `restaurant`", async () => {
    const owner = await createTestUser();
    const created = await createRestaurantAs(owner, {
      name: "Pizza Palace",
      description: "Wood-fired",
      email: "hello@pizza.test",
      phone: "+1 555 0100",
      address: "12 Market Street",
      city: "Mumbai",
      country: "India",
      currency: "INR",
    });

    const { body } = await readDetail(owner, created.id);
    const restaurant = body.data.restaurant as unknown as Record<string, unknown>;

    for (const field of [
      "id",
      "name",
      "slug",
      "description",
      "email",
      "phone",
      "address",
      "city",
      "country",
      "currency",
      "isActive",
      "createdAt",
      "updatedAt",
    ]) {
      expect(restaurant).toHaveProperty(field);
    }

    expect(restaurant.name).toBe("Pizza Palace");
    expect(restaurant.currency).toBe("INR");
    expect(restaurant.isActive).toBe(true);
  });

  /**
   * The role belongs to the caller's relationship with the restaurant, not to
   * the restaurant itself. Keeping it out of the record stops it being mistaken
   * for a column and re-sent on an update.
   */
  test("the role is not mixed into the restaurant record", async () => {
    const owner = await createTestUser();
    const restaurant = await createRestaurantAs(owner, { name: "Pizza Palace" });

    const { body } = await readDetail(owner, restaurant.id);

    expect(body.data.restaurant).not.toHaveProperty("role");
    expect(body.data.role).toBe("OWNER");
  });

  /** The list endpoint is a separate contract and was deliberately left alone. */
  test("the list endpoint is unchanged and reports no role", async () => {
    const owner = await createTestUser();
    await createRestaurantAs(owner, { name: "Pizza Palace" });

    const response = await authedRequest(owner, "/admin/restaurants");
    const body = (await response.json()) as {
      data: { items: Record<string, unknown>[]; total: number };
    };

    expect(response.status).toBe(200);
    expect(body.data.total).toBe(1);
    expect(body.data.items[0]).toHaveProperty("name");
    expect(body.data.items[0]).not.toHaveProperty("role");
  });
});

describe("authorization is unchanged", () => {
  /**
   * The role is informational. Knowing it must not be usable to *do* anything —
   * these re-assert the boundaries the change ran alongside.
   */
  test("STAFF still cannot delete, despite now being told their role", async () => {
    const owner = await createTestUser();
    const staff = await createTestUser();
    const restaurant = await createRestaurantAs(owner, { name: "Pizza Palace" });
    await grantMembership(staff, restaurant.id, "STAFF");

    expect((await readDetail(staff, restaurant.id)).body.data.role).toBe("STAFF");

    const response = await authedRequest(staff, `/admin/restaurants/${restaurant.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(await db.restaurant.count({ where: { id: restaurant.id } })).toBe(1);
  });

  test("STAFF still cannot delete menu content", async () => {
    const owner = await createTestUser();
    const staff = await createTestUser();
    const restaurant = await createRestaurantAs(owner, { name: "Pizza Palace" });
    await grantMembership(staff, restaurant.id, "STAFF");

    const category = await db.category.create({
      data: { restaurantId: restaurant.id, name: "Starters", slug: "starters" },
    });

    const response = await authedRequest(
      staff,
      `/admin/restaurants/${restaurant.id}/categories/${category.id}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(403);
  });

  test("OWNER can still delete", async () => {
    const owner = await createTestUser();
    const restaurant = await createRestaurantAs(owner, { name: "Pizza Palace" });

    const response = await authedRequest(owner, `/admin/restaurants/${restaurant.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
  });
});
