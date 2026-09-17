import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@repo/database";
import { app } from "../../app.ts";
import {
  authedRequest,
  createCategoryAs,
  createMenuItemAs,
  createRestaurantAs,
  createTestUser,
  grantMembership,
  resetDatabase,
} from "../../test-support/helpers.ts";

beforeEach(async () => {
  await resetDatabase();
});

async function ownerWithCategory() {
  const owner = await createTestUser();
  const restaurant = await createRestaurantAs(owner, { name: "Pizza Palace" });
  const category = await createCategoryAs(owner, restaurant.id, { name: "Mains" });
  return { owner, restaurant, category };
}

function itemsPath(restaurantId: string) {
  return `/admin/restaurants/${restaurantId}/menu-items`;
}

describe("authentication", () => {
  test.each([
    ["GET", ""],
    ["POST", ""],
    ["GET", "/some-item"],
    ["PATCH", "/some-item"],
    ["DELETE", "/some-item"],
  ])("%s menu-items%s rejects anonymous callers with 401", async (method, suffix) => {
    const response = await app.request(`${itemsPath("some-restaurant")}${suffix}`, {
      method,
      ...(method === "POST" || method === "PATCH"
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "X" }) }
        : {}),
    });

    expect(response.status).toBe(401);
  });
});

describe("menu item creation", () => {
  test("creates an item inside its category", async () => {
    const { owner, restaurant, category } = await ownerWithCategory();

    const response = await authedRequest(owner, itemsPath(restaurant.id), {
      method: "POST",
      body: JSON.stringify({ categoryId: category.id, name: "Margherita", priceMinor: 1250 }),
    });
    const body = (await response.json()) as {
      data: {
        name: string;
        priceMinor: number;
        categoryId: string;
        restaurantId: string;
        isActive: boolean;
        isAvailable: boolean;
      };
    };

    expect(response.status).toBe(201);
    expect(body.data.priceMinor).toBe(1250);
    expect(body.data.categoryId).toBe(category.id);
    expect(body.data.restaurantId).toBe(restaurant.id);
    expect(body.data.isActive).toBe(true);
    expect(body.data.isAvailable).toBe(true);
  });

  test("a free item is allowed", async () => {
    const { owner, restaurant, category } = await ownerWithCategory();

    const item = await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Tap Water",
      priceMinor: 0,
    });

    expect(item.priceMinor).toBe(0);
  });

  /**
   * The category must belong to the caller's restaurant. The composite foreign
   * key would reject it anyway; this is the clean error rather than a
   * constraint violation surfacing as a 500.
   */
  test("an item cannot be filed under another restaurant's category", async () => {
    const { owner, restaurant } = await ownerWithCategory();
    const otherOwner = await createTestUser();
    const other = await createRestaurantAs(otherOwner, { name: "Corner Cafe" });
    const otherCategory = await createCategoryAs(otherOwner, other.id, { name: "Theirs" });

    const response = await authedRequest(owner, itemsPath(restaurant.id), {
      method: "POST",
      body: JSON.stringify({
        categoryId: otherCategory.id,
        name: "Cross-tenant dish",
        priceMinor: 100,
      }),
    });

    expect(response.status).toBe(404);
    expect(await db.menuItem.count({ where: { categoryId: otherCategory.id } })).toBe(0);
  });

  test("a nonexistent category is a 404", async () => {
    const { owner, restaurant } = await ownerWithCategory();

    const response = await authedRequest(owner, itemsPath(restaurant.id), {
      method: "POST",
      body: JSON.stringify({ categoryId: "no-such-category", name: "Ghost", priceMinor: 100 }),
    });

    expect(response.status).toBe(404);
  });

  test("a restaurantId in the body cannot redirect the write", async () => {
    const { owner, restaurant, category } = await ownerWithCategory();
    const victimOwner = await createTestUser();
    const victim = await createRestaurantAs(victimOwner, { name: "Victim Bistro" });

    await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Injected",
      priceMinor: 100,
      restaurantId: victim.id,
    });

    expect(await db.menuItem.count({ where: { restaurantId: victim.id } })).toBe(0);
    expect(await db.menuItem.count({ where: { restaurantId: restaurant.id } })).toBe(1);
  });
});

describe("price validation", () => {
  test.each([
    ["a decimal price", 12.5],
    ["a price as a string", "12.50"],
    ["a negative price", -1],
    ["an absurd price", 100_000_000],
    ["null", null],
    ["NaN-producing input", "abc"],
  ])("rejects %s with 400", async (_label, priceMinor) => {
    const { owner, restaurant, category } = await ownerWithCategory();

    const response = await authedRequest(owner, itemsPath(restaurant.id), {
      method: "POST",
      body: JSON.stringify({ categoryId: category.id, name: "Dish", priceMinor }),
    });

    expect(response.status).toBe(400);
  });

  test("a missing price is rejected — an item with no price is not a menu item", async () => {
    const { owner, restaurant, category } = await ownerWithCategory();

    const response = await authedRequest(owner, itemsPath(restaurant.id), {
      method: "POST",
      body: JSON.stringify({ categoryId: category.id, name: "Dish" }),
    });

    expect(response.status).toBe(400);
  });

  /**
   * `12.50` is ambiguous — 12 cents and a half, or 12.50 in major units? —
   * and silently rounding it would decide what a customer is charged.
   */
  test("a decimal price is refused rather than rounded", async () => {
    const { owner, restaurant, category } = await ownerWithCategory();

    const response = await authedRequest(owner, itemsPath(restaurant.id), {
      method: "POST",
      body: JSON.stringify({ categoryId: category.id, name: "Dish", priceMinor: 1250.4 }),
    });

    expect(response.status).toBe(400);
    expect(await db.menuItem.count()).toBe(0);
  });

  test("the stored price is an exact integer, never a float", async () => {
    const { owner, restaurant, category } = await ownerWithCategory();
    const item = await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Dish",
      priceMinor: 1010,
    });

    const stored = await db.menuItem.findUnique({ where: { id: item.id } });
    expect(stored?.priceMinor).toBe(1010);
    expect(Number.isInteger(stored?.priceMinor)).toBe(true);
  });
});

describe("menu item validation", () => {
  test.each([
    ["missing name", { priceMinor: 100 }],
    ["empty name", { name: "", priceMinor: 100 }],
    ["over-long name", { name: "x".repeat(181), priceMinor: 100 }],
    ["over-long description", { name: "Ok", description: "x".repeat(1001), priceMinor: 100 }],
    ["empty categoryId", { categoryId: "", name: "Ok", priceMinor: 100 }],
    ["negative position", { name: "Ok", priceMinor: 100, position: -1 }],
    ["isAvailable as a string", { name: "Ok", priceMinor: 100, isAvailable: "false" }],
  ])("rejects %s with 400", async (_label, payload) => {
    const { owner, restaurant, category } = await ownerWithCategory();

    const response = await authedRequest(owner, itemsPath(restaurant.id), {
      method: "POST",
      body: JSON.stringify({ categoryId: category.id, ...payload }),
    });

    expect(response.status).toBe(400);
  });

  test("an item with no category at all is rejected", async () => {
    const { owner, restaurant } = await ownerWithCategory();

    const response = await authedRequest(owner, itemsPath(restaurant.id), {
      method: "POST",
      body: JSON.stringify({ name: "Orphan", priceMinor: 100 }),
    });

    expect(response.status).toBe(400);
  });

  test("unexpected fields are stripped rather than persisted", async () => {
    const { owner, restaurant, category } = await ownerWithCategory();

    const item = await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Dish",
      priceMinor: 100,
      id: "attacker-chosen-id",
    });

    expect(item.id).not.toBe("attacker-chosen-id");
  });

  test("a malformed item id reads as absent", async () => {
    const { owner, restaurant } = await ownerWithCategory();

    const response = await authedRequest(owner, `${itemsPath(restaurant.id)}/not-a-real-id`);
    expect(response.status).toBe(404);
  });
});

describe("menu item ordering", () => {
  test("positions are assigned per category, in creation order", async () => {
    const { owner, restaurant, category } = await ownerWithCategory();
    const second = await createCategoryAs(owner, restaurant.id, { name: "Desserts" });

    const a = await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "A",
      priceMinor: 1,
    });
    const b = await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "B",
      priceMinor: 1,
    });
    // A new category starts its own numbering rather than continuing the last.
    const c = await createMenuItemAs(owner, restaurant.id, {
      categoryId: second.id,
      name: "C",
      priceMinor: 1,
    });

    expect([a.position, b.position, c.position]).toEqual([0, 1, 0]);
  });

  test("items are listed in position order", async () => {
    const { owner, restaurant, category } = await ownerWithCategory();
    await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Last",
      priceMinor: 1,
      position: 50,
    });
    await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "First",
      priceMinor: 1,
      position: 1,
    });

    const response = await authedRequest(owner, itemsPath(restaurant.id));
    const body = (await response.json()) as { data: { items: { name: string }[] } };

    expect(body.data.items.map((i) => i.name)).toEqual(["First", "Last"]);
  });

  test("items sharing a position still have a stable, repeatable order", async () => {
    const { owner, restaurant, category } = await ownerWithCategory();

    await Promise.all(
      ["A", "B", "C"].map((name) =>
        createMenuItemAs(owner, restaurant.id, {
          categoryId: category.id,
          name,
          priceMinor: 1,
          position: 0,
        }),
      ),
    );

    const read = async () => {
      const response = await authedRequest(owner, itemsPath(restaurant.id));
      const body = (await response.json()) as { data: { items: { name: string }[] } };
      return body.data.items.map((i) => i.name);
    };

    const first = await read();
    expect(first).toHaveLength(3);
    expect(await read()).toEqual(first);
  });

  test("concurrent creates all succeed and none is lost", async () => {
    const { owner, restaurant, category } = await ownerWithCategory();

    const results = await Promise.all(
      ["A", "B", "C", "D", "E"].map((name) =>
        authedRequest(owner, itemsPath(restaurant.id), {
          method: "POST",
          body: JSON.stringify({ categoryId: category.id, name, priceMinor: 100 }),
        }),
      ),
    );

    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(await db.menuItem.count({ where: { categoryId: category.id } })).toBe(5);
  });
});

describe("menu item updates", () => {
  test("a partial update changes only what was sent", async () => {
    const { owner, restaurant, category } = await ownerWithCategory();
    const item = await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Margherita",
      description: "Tomato and basil",
      priceMinor: 1250,
    });

    const response = await authedRequest(owner, `${itemsPath(restaurant.id)}/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ priceMinor: 1350 }),
    });
    const body = (await response.json()) as {
      data: { priceMinor: number; name: string; description: string };
    };

    expect(response.status).toBe(200);
    expect(body.data.priceMinor).toBe(1350);
    expect(body.data.name).toBe("Margherita");
    expect(body.data.description).toBe("Tomato and basil");
  });

  test("an item can be moved to another category in the same restaurant", async () => {
    const { owner, restaurant, category } = await ownerWithCategory();
    const specials = await createCategoryAs(owner, restaurant.id, { name: "Specials" });
    const item = await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Margherita",
      priceMinor: 1250,
    });

    const response = await authedRequest(owner, `${itemsPath(restaurant.id)}/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ categoryId: specials.id }),
    });

    expect(response.status).toBe(200);
    const stored = await db.menuItem.findUnique({ where: { id: item.id } });
    expect(stored?.categoryId).toBe(specials.id);
  });

  test("an item cannot be moved into another restaurant's category", async () => {
    const { owner, restaurant, category } = await ownerWithCategory();
    const otherOwner = await createTestUser();
    const other = await createRestaurantAs(otherOwner, { name: "Corner Cafe" });
    const otherCategory = await createCategoryAs(otherOwner, other.id, { name: "Theirs" });
    const item = await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Margherita",
      priceMinor: 1250,
    });

    const response = await authedRequest(owner, `${itemsPath(restaurant.id)}/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ categoryId: otherCategory.id }),
    });

    expect(response.status).toBe(404);
    const stored = await db.menuItem.findUnique({ where: { id: item.id } });
    expect(stored?.categoryId).toBe(category.id);
  });

  test("marking an item sold out does not remove it", async () => {
    const { owner, restaurant, category } = await ownerWithCategory();
    const item = await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Soup",
      priceMinor: 500,
    });

    await authedRequest(owner, `${itemsPath(restaurant.id)}/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isAvailable: false }),
    });

    const stored = await db.menuItem.findUnique({ where: { id: item.id } });
    expect(stored?.isAvailable).toBe(false);
    expect(stored?.isActive).toBe(true);
  });
});

describe("menu item filtering", () => {
  async function mixedMenu() {
    const { owner, restaurant, category } = await ownerWithCategory();
    const desserts = await createCategoryAs(owner, restaurant.id, { name: "Desserts" });

    await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Available Main",
      priceMinor: 100,
    });
    await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Sold Out Main",
      priceMinor: 100,
      isAvailable: false,
    });
    await createMenuItemAs(owner, restaurant.id, {
      categoryId: desserts.id,
      name: "Hidden Dessert",
      priceMinor: 100,
      isActive: false,
    });

    return { owner, restaurant, category, desserts };
  }

  test("filters by category", async () => {
    const { owner, restaurant, desserts } = await mixedMenu();

    const response = await authedRequest(
      owner,
      `${itemsPath(restaurant.id)}?categoryId=${desserts.id}`,
    );
    const body = (await response.json()) as { data: { items: { name: string }[]; total: number } };

    expect(body.data.total).toBe(1);
    expect(body.data.items[0]?.name).toBe("Hidden Dessert");
  });

  test("filters by availability, reading 'false' as false", async () => {
    const { owner, restaurant } = await mixedMenu();

    const response = await authedRequest(owner, `${itemsPath(restaurant.id)}?isAvailable=false`);
    const body = (await response.json()) as { data: { items: { name: string }[]; total: number } };

    expect(body.data.total).toBe(1);
    expect(body.data.items[0]?.name).toBe("Sold Out Main");
  });

  test("rejects a boolean filter that is neither 'true' nor 'false'", async () => {
    const { owner, restaurant } = await mixedMenu();

    const response = await authedRequest(owner, `${itemsPath(restaurant.id)}?isActive=yes`);
    expect(response.status).toBe(400);
  });

  test("the admin list shows hidden items — that is what admin is for", async () => {
    const { owner, restaurant } = await mixedMenu();

    const response = await authedRequest(owner, itemsPath(restaurant.id));
    const body = (await response.json()) as { data: { total: number } };

    expect(body.data.total).toBe(3);
  });

  test("pagination bounds the response", async () => {
    const { owner, restaurant } = await mixedMenu();

    const response = await authedRequest(owner, `${itemsPath(restaurant.id)}?limit=2&page=1`);
    const body = (await response.json()) as {
      data: { items: unknown[]; total: number; limit: number };
    };

    expect(body.data.items).toHaveLength(2);
    expect(body.data.total).toBe(3);
    expect(body.data.limit).toBe(2);
  });

  test("rejects a limit above the cap", async () => {
    const { owner, restaurant } = await mixedMenu();

    const response = await authedRequest(owner, `${itemsPath(restaurant.id)}?limit=1000`);
    expect(response.status).toBe(400);
  });
});

describe("tenant isolation", () => {
  async function twoRestaurants() {
    const { owner: ownerA, restaurant: restaurantA } = await ownerWithCategory();
    const ownerB = await createTestUser();
    const restaurantB = await createRestaurantAs(ownerB, { name: "Restaurant B" });
    const categoryB = await createCategoryAs(ownerB, restaurantB.id, { name: "B Mains" });
    const itemB = await createMenuItemAs(ownerB, restaurantB.id, {
      categoryId: categoryB.id,
      name: "B Dish",
      priceMinor: 500,
    });
    return { ownerA, restaurantA, ownerB, restaurantB, itemB };
  }

  test("a non-member cannot list another restaurant's items", async () => {
    const { ownerA, restaurantB } = await twoRestaurants();

    const response = await authedRequest(ownerA, itemsPath(restaurantB.id));
    expect(response.status).toBe(403);
  });

  test("a non-member cannot read, update, or delete another restaurant's item", async () => {
    const { ownerA, restaurantB, itemB } = await twoRestaurants();
    const path = `${itemsPath(restaurantB.id)}/${itemB.id}`;

    expect((await authedRequest(ownerA, path)).status).toBe(403);
    expect(
      (
        await authedRequest(ownerA, path, {
          method: "PATCH",
          body: JSON.stringify({ priceMinor: 1 }),
        })
      ).status,
    ).toBe(403);
    expect((await authedRequest(ownerA, path, { method: "DELETE" })).status).toBe(403);

    const stored = await db.menuItem.findUnique({ where: { id: itemB.id } });
    expect(stored?.priceMinor).toBe(500);
  });

  /**
   * A real item id addressed through a restaurant the caller does own:
   * authorization passes, so the scoped lookup is the only thing standing
   * between them and someone else's data.
   */
  test("another restaurant's item is not reachable through one's own restaurant", async () => {
    const { ownerA, restaurantA, itemB } = await twoRestaurants();
    const path = `${itemsPath(restaurantA.id)}/${itemB.id}`;

    expect((await authedRequest(ownerA, path)).status).toBe(404);
    expect(
      (
        await authedRequest(ownerA, path, {
          method: "PATCH",
          body: JSON.stringify({ priceMinor: 1 }),
        })
      ).status,
    ).toBe(404);
    expect((await authedRequest(ownerA, path, { method: "DELETE" })).status).toBe(404);

    const stored = await db.menuItem.findUnique({ where: { id: itemB.id } });
    expect(stored?.priceMinor).toBe(500);
    expect(stored).not.toBeNull();
  });
});

describe("STAFF policy", () => {
  async function ownerAndStaff() {
    const { owner, restaurant, category } = await ownerWithCategory();
    const staff = await createTestUser();
    await grantMembership(staff, restaurant.id, "STAFF");
    return { owner, staff, restaurant, category };
  }

  test("STAFF may create and update items", async () => {
    const { staff, restaurant, category } = await ownerAndStaff();

    const created = await authedRequest(staff, itemsPath(restaurant.id), {
      method: "POST",
      body: JSON.stringify({ categoryId: category.id, name: "Special", priceMinor: 900 }),
    });
    expect(created.status).toBe(201);

    const { data } = (await created.json()) as { data: { id: string } };

    // The archetypal staff action: marking a dish sold out mid-service.
    const updated = await authedRequest(staff, `${itemsPath(restaurant.id)}/${data.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isAvailable: false }),
    });
    expect(updated.status).toBe(200);
  });

  test("STAFF may NOT delete an item", async () => {
    const { owner, staff, restaurant, category } = await ownerAndStaff();
    const item = await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Margherita",
      priceMinor: 1250,
    });

    const response = await authedRequest(staff, `${itemsPath(restaurant.id)}/${item.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(await db.menuItem.count({ where: { id: item.id } })).toBe(1);
  });

  test("OWNER may delete an item", async () => {
    const { owner, restaurant, category } = await ownerAndStaff();
    const item = await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Margherita",
      priceMinor: 1250,
    });

    const response = await authedRequest(owner, `${itemsPath(restaurant.id)}/${item.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(await db.menuItem.count({ where: { id: item.id } })).toBe(0);
  });
});
