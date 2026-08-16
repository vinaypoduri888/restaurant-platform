import { beforeEach, describe, expect, test } from "bun:test";
import { app } from "../../app.ts";
import {
  authedRequest,
  createRestaurantAs,
  createTestUser,
  resetDatabase,
} from "../../test-support/helpers.ts";

beforeEach(async () => {
  await resetDatabase();
});

describe("authentication", () => {
  test.each([
    ["GET", "/admin/restaurants"],
    ["POST", "/admin/restaurants"],
    ["GET", "/admin/restaurants/some-id"],
    ["PATCH", "/admin/restaurants/some-id"],
    ["DELETE", "/admin/restaurants/some-id"],
  ])("%s %s rejects anonymous callers with 401", async (method, path) => {
    const response = await app.request(path, {
      method,
      ...(method === "POST" || method === "PATCH"
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "X" }) }
        : {}),
    });

    expect(response.status).toBe(401);
  });

  test("an invalid session cookie is rejected", async () => {
    const response = await app.request("/admin/restaurants", {
      headers: { Cookie: "better-auth.session_token=forged-value" },
    });

    expect(response.status).toBe(401);
  });
});

describe("restaurant creation", () => {
  test("creates a restaurant and makes the creator its owner", async () => {
    const user = await createTestUser();

    const response = await authedRequest(user, "/admin/restaurants", {
      method: "POST",
      body: JSON.stringify({ name: "Pizza Palace", city: "Mumbai" }),
    });
    const body = (await response.json()) as { success: boolean; data: { slug: string } };

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.slug).toBe("pizza-palace");

    // The creator must be able to read it back, which only holds if the owner
    // membership was written in the same transaction.
    const list = await authedRequest(user, "/admin/restaurants");
    const listBody = (await list.json()) as { data: { total: number } };
    expect(listBody.data.total).toBe(1);
  });

  test("accepts an explicit slug", async () => {
    const user = await createTestUser();
    const restaurant = await createRestaurantAs(user, {
      name: "Pizza Palace",
      slug: "custom-slug",
    });

    expect(restaurant.slug).toBe("custom-slug");
  });

  test("rejects a duplicate slug with 409", async () => {
    const user = await createTestUser();
    await createRestaurantAs(user, { name: "Pizza Palace" });

    const response = await authedRequest(user, "/admin/restaurants", {
      method: "POST",
      body: JSON.stringify({ name: "Pizza Palace" }),
    });

    expect(response.status).toBe(409);
  });

  test("a duplicate slug is rejected even across different owners", async () => {
    const [first, second] = await Promise.all([createTestUser(), createTestUser()]);
    await createRestaurantAs(first, { name: "Pizza Palace" });

    const response = await authedRequest(second, "/admin/restaurants", {
      method: "POST",
      body: JSON.stringify({ name: "Pizza Palace" }),
    });

    expect(response.status).toBe(409);
  });

  test("concurrent creates of the same slug produce exactly one restaurant", async () => {
    const user = await createTestUser();

    // Exercises the race the pre-flight uniqueness check cannot cover: both
    // requests can pass the check, so the database constraint is the real
    // guarantee and must surface as 409 rather than 500.
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        authedRequest(user, "/admin/restaurants", {
          method: "POST",
          body: JSON.stringify({ name: "Race Diner" }),
        }),
      ),
    );

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(3);
    expect(statuses).not.toContain(500);
  });
});

describe("validation", () => {
  test("rejects an empty name with 400 and field-level issues", async () => {
    const user = await createTestUser();

    const response = await authedRequest(user, "/admin/restaurants", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
    });
    const body = (await response.json()) as {
      success: boolean;
      error: { message: string; issues: { path: string[] }[] };
    };

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.message).toBe("Validation failed");
    expect(body.error.issues[0]?.path).toEqual(["name"]);
  });

  test("rejects a malformed email", async () => {
    const user = await createTestUser();

    const response = await authedRequest(user, "/admin/restaurants", {
      method: "POST",
      body: JSON.stringify({ name: "Valid", email: "not-an-email" }),
    });

    expect(response.status).toBe(400);
  });

  test("rejects a slug containing invalid characters", async () => {
    const user = await createTestUser();

    const response = await authedRequest(user, "/admin/restaurants", {
      method: "POST",
      body: JSON.stringify({ name: "Valid", slug: "Not A Slug!" }),
    });

    expect(response.status).toBe(400);
  });

  test("rejects an out-of-range pagination limit", async () => {
    const user = await createTestUser();
    const response = await authedRequest(user, "/admin/restaurants?limit=500");

    expect(response.status).toBe(400);
  });
});

/**
 * Regression coverage for the audit's MEDIUM finding: the filter used
 * `z.coerce.boolean()`, so the string "false" coerced to `true` and
 * `?isActive=false` returned active restaurants.
 */
describe("isActive query filtering", () => {
  async function userWithOneActiveAndOneInactive() {
    const user = await createTestUser();
    await createRestaurantAs(user, { name: "Active Restaurant" });
    const inactive = await createRestaurantAs(user, { name: "Inactive Restaurant" });

    await authedRequest(user, `/admin/restaurants/${inactive.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
    });

    return user;
  }

  async function namesFor(user: Awaited<ReturnType<typeof createTestUser>>, query: string) {
    const response = await authedRequest(user, `/admin/restaurants${query}`);
    const body = (await response.json()) as { data: { items: { name: string }[] } };
    return { status: response.status, names: body.data?.items.map((item) => item.name) ?? [] };
  }

  test("?isActive=true returns only active restaurants", async () => {
    const user = await userWithOneActiveAndOneInactive();
    const { status, names } = await namesFor(user, "?isActive=true");

    expect(status).toBe(200);
    expect(names).toEqual(["Active Restaurant"]);
  });

  test("?isActive=false returns only inactive restaurants", async () => {
    const user = await userWithOneActiveAndOneInactive();
    const { status, names } = await namesFor(user, "?isActive=false");

    expect(status).toBe(200);
    expect(names).toEqual(["Inactive Restaurant"]);
  });

  test("omitting isActive returns both", async () => {
    const user = await userWithOneActiveAndOneInactive();
    const { names } = await namesFor(user, "");

    expect(names.sort()).toEqual(["Active Restaurant", "Inactive Restaurant"]);
  });

  test.each(["yes", "0", "1", "maybe", ""])(
    "rejects the non-boolean value %p rather than guessing",
    async (value) => {
      const user = await createTestUser();
      const response = await authedRequest(user, `/admin/restaurants?isActive=${value}`);

      expect(response.status).toBe(400);
    },
  );
});

describe("retrieval and update", () => {
  test("an owner can read their own restaurant", async () => {
    const user = await createTestUser();
    const restaurant = await createRestaurantAs(user, { name: "Pizza Palace" });

    const response = await authedRequest(user, `/admin/restaurants/${restaurant.id}`);
    const body = (await response.json()) as { data: { id: string } };

    expect(response.status).toBe(200);
    expect(body.data.id).toBe(restaurant.id);
  });

  test("a missing restaurant is not distinguishable from one you cannot access", async () => {
    const user = await createTestUser();

    // Both cases must answer 403 so the API never confirms which ids exist.
    const response = await authedRequest(user, "/admin/restaurants/cmnonexistentid00000000");
    expect(response.status).toBe(403);
  });

  test("an owner can update their restaurant", async () => {
    const user = await createTestUser();
    const restaurant = await createRestaurantAs(user, { name: "Pizza Palace" });

    const response = await authedRequest(user, `/admin/restaurants/${restaurant.id}`, {
      method: "PATCH",
      body: JSON.stringify({ description: "Best pizza in town" }),
    });
    const body = (await response.json()) as { data: { description: string } };

    expect(response.status).toBe(200);
    expect(body.data.description).toBe("Best pizza in town");
  });

  test("an owner can delete their restaurant", async () => {
    const user = await createTestUser();
    const restaurant = await createRestaurantAs(user, { name: "Pizza Palace" });

    const deleted = await authedRequest(user, `/admin/restaurants/${restaurant.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);

    const after = await authedRequest(user, "/admin/restaurants");
    const body = (await after.json()) as { data: { total: number } };
    expect(body.data.total).toBe(0);
  });
});

describe("authorization boundaries", () => {
  test("a user's list contains only their own restaurants", async () => {
    const [owner, outsider] = await Promise.all([createTestUser(), createTestUser()]);
    await createRestaurantAs(owner, { name: "Owned Restaurant" });

    const response = await authedRequest(outsider, "/admin/restaurants");
    const body = (await response.json()) as { data: { total: number; items: unknown[] } };

    expect(body.data.total).toBe(0);
    expect(body.data.items).toHaveLength(0);
  });

  test.each([
    ["GET", undefined],
    ["PATCH", JSON.stringify({ name: "Hijacked" })],
    ["DELETE", undefined],
  ])("a non-member cannot %s another user's restaurant", async (method, body) => {
    const [owner, outsider] = await Promise.all([createTestUser(), createTestUser()]);
    const restaurant = await createRestaurantAs(owner, { name: "Owned Restaurant" });

    const response = await authedRequest(outsider, `/admin/restaurants/${restaurant.id}`, {
      method,
      ...(body ? { body } : {}),
    });

    expect(response.status).toBe(403);
  });

  test("a rejected update leaves the record unchanged", async () => {
    const [owner, outsider] = await Promise.all([createTestUser(), createTestUser()]);
    const restaurant = await createRestaurantAs(owner, { name: "Original Name" });

    await authedRequest(outsider, `/admin/restaurants/${restaurant.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Hijacked" }),
    });

    const check = await authedRequest(owner, `/admin/restaurants/${restaurant.id}`);
    const body = (await check.json()) as { data: { name: string } };
    expect(body.data.name).toBe("Original Name");
  });
});

describe("pagination", () => {
  test("splits results across pages with a stable total", async () => {
    const user = await createTestUser();
    for (let index = 0; index < 5; index += 1) {
      await createRestaurantAs(user, { name: `Restaurant ${index}` });
    }

    const first = await authedRequest(user, "/admin/restaurants?page=1&limit=2");
    const firstBody = (await first.json()) as {
      data: { items: { id: string }[]; total: number; page: number; limit: number };
    };

    expect(firstBody.data.items).toHaveLength(2);
    expect(firstBody.data.total).toBe(5);
    expect(firstBody.data.page).toBe(1);
    expect(firstBody.data.limit).toBe(2);

    const third = await authedRequest(user, "/admin/restaurants?page=3&limit=2");
    const thirdBody = (await third.json()) as { data: { items: { id: string }[] } };
    expect(thirdBody.data.items).toHaveLength(1);
  });

  test("pages do not overlap", async () => {
    const user = await createTestUser();
    for (let index = 0; index < 4; index += 1) {
      await createRestaurantAs(user, { name: `Restaurant ${index}` });
    }

    const [first, second] = await Promise.all([
      authedRequest(user, "/admin/restaurants?page=1&limit=2"),
      authedRequest(user, "/admin/restaurants?page=2&limit=2"),
    ]);

    const firstIds = ((await first.json()) as { data: { items: { id: string }[] } }).data.items.map(
      (item) => item.id,
    );
    const secondIds = (
      (await second.json()) as { data: { items: { id: string }[] } }
    ).data.items.map((item) => item.id);

    expect(firstIds).toHaveLength(2);
    expect(secondIds).toHaveLength(2);
    // Deterministic ordering is what makes this hold; without it an item can
    // appear on both pages or on neither.
    expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
  });
});

describe("public surface", () => {
  test("lists active restaurants without authentication", async () => {
    const user = await createTestUser();
    await createRestaurantAs(user, { name: "Public Restaurant" });

    const response = await app.request("/restaurants");
    const body = (await response.json()) as { data: { total: number } };

    expect(response.status).toBe(200);
    expect(body.data.total).toBe(1);
  });

  test("does not expose administrative fields", async () => {
    const user = await createTestUser();
    await createRestaurantAs(user, {
      name: "Public Restaurant",
      email: "private@example.test",
      phone: "+15550000",
    });

    const response = await app.request("/restaurants");
    const body = (await response.json()) as { data: { items: Record<string, unknown>[] } };
    const item = body.data.items[0] ?? {};

    // Contact details and internal bookkeeping belong to the admin API only.
    expect(item).not.toHaveProperty("email");
    expect(item).not.toHaveProperty("phone");
    expect(item).not.toHaveProperty("isActive");
    expect(item).not.toHaveProperty("createdAt");
    expect(item).toHaveProperty("name");
  });

  test("resolves a restaurant by slug", async () => {
    const user = await createTestUser();
    await createRestaurantAs(user, { name: "Pizza Palace" });

    const response = await app.request("/restaurants/pizza-palace");
    const body = (await response.json()) as { data: { slug: string } };

    expect(response.status).toBe(200);
    expect(body.data.slug).toBe("pizza-palace");
  });

  test("hides deactivated restaurants", async () => {
    const user = await createTestUser();
    const restaurant = await createRestaurantAs(user, { name: "Pizza Palace" });

    await authedRequest(user, `/admin/restaurants/${restaurant.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
    });

    const list = await app.request("/restaurants");
    const listBody = (await list.json()) as { data: { total: number } };
    expect(listBody.data.total).toBe(0);

    const bySlug = await app.request("/restaurants/pizza-palace");
    expect(bySlug.status).toBe(404);
  });

  test("returns 404 for an unknown slug", async () => {
    const response = await app.request("/restaurants/no-such-restaurant");
    expect(response.status).toBe(404);
  });
});
