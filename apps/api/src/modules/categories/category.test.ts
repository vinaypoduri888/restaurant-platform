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
  type TestUser,
} from "../../test-support/helpers.ts";

beforeEach(async () => {
  await resetDatabase();
});

async function ownerWithRestaurant() {
  const owner = await createTestUser();
  const restaurant = await createRestaurantAs(owner, { name: "Pizza Palace" });
  return { owner, restaurant };
}

function categoriesPath(restaurantId: string) {
  return `/admin/restaurants/${restaurantId}/categories`;
}

describe("authentication", () => {
  test.each([
    ["GET", ""],
    ["POST", ""],
    ["GET", "/some-category"],
    ["PATCH", "/some-category"],
    ["DELETE", "/some-category"],
  ])("%s categories%s rejects anonymous callers with 401", async (method, suffix) => {
    const response = await app.request(`${categoriesPath("some-restaurant")}${suffix}`, {
      method,
      ...(method === "POST" || method === "PATCH"
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "X" }) }
        : {}),
    });

    expect(response.status).toBe(401);
  });
});

describe("category creation", () => {
  test("creates a category and derives its slug from the name", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await authedRequest(owner, categoriesPath(restaurant.id), {
      method: "POST",
      body: JSON.stringify({ name: "Wood-Fired Starters" }),
    });
    const body = (await response.json()) as {
      data: { slug: string; position: number; isActive: boolean; restaurantId: string };
    };

    expect(response.status).toBe(201);
    expect(body.data.slug).toBe("wood-fired-starters");
    expect(body.data.isActive).toBe(true);
    expect(body.data.restaurantId).toBe(restaurant.id);
  });

  test("an explicit slug is accepted", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const category = await createCategoryAs(owner, restaurant.id, {
      name: "Starters",
      slug: "small-plates",
    });

    expect(category.slug).toBe("small-plates");
  });

  /**
   * The category is written with the restaurant id from the authorized URL, so
   * a body field naming another restaurant has nowhere to take effect. Zod
   * strips it before the service ever sees it.
   */
  test("a restaurantId in the body cannot redirect the write", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const victimOwner = await createTestUser();
    const victim = await createRestaurantAs(victimOwner, { name: "Victim Bistro" });

    await createCategoryAs(owner, restaurant.id, {
      name: "Injected",
      restaurantId: victim.id,
    });

    expect(await db.category.count({ where: { restaurantId: victim.id } })).toBe(0);
    expect(await db.category.count({ where: { restaurantId: restaurant.id } })).toBe(1);
  });

  test("a duplicate slug within one restaurant is a 409", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await createCategoryAs(owner, restaurant.id, { name: "Desserts" });

    const response = await authedRequest(owner, categoriesPath(restaurant.id), {
      method: "POST",
      body: JSON.stringify({ name: "Desserts" }),
    });

    expect(response.status).toBe(409);
  });

  /**
   * Slugs are unique per restaurant, not globally — otherwise the first
   * restaurant to create a "desserts" section would take the name from every
   * other restaurant on the platform.
   */
  test("the same slug in a different restaurant is allowed", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const otherOwner = await createTestUser();
    const other = await createRestaurantAs(otherOwner, { name: "Corner Cafe" });

    await createCategoryAs(owner, restaurant.id, { name: "Desserts" });
    const second = await createCategoryAs(otherOwner, other.id, { name: "Desserts" });

    expect(second.slug).toBe("desserts");
  });

  test("a name with no slug-able characters is rejected rather than given an empty slug", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await authedRequest(owner, categoriesPath(restaurant.id), {
      method: "POST",
      body: JSON.stringify({ name: "!!!" }),
    });

    expect(response.status).toBe(400);
  });
});

describe("category validation", () => {
  test.each([
    ["missing name", {}],
    ["empty name", { name: "" }],
    ["whitespace-only name", { name: "   " }],
    ["over-long name", { name: "x".repeat(121) }],
    ["over-long description", { name: "Ok", description: "x".repeat(501) }],
    ["malformed slug", { name: "Ok", slug: "Not A Slug!" }],
    ["negative position", { name: "Ok", position: -1 }],
    ["fractional position", { name: "Ok", position: 1.5 }],
    ["position as a string", { name: "Ok", position: "1" }],
    ["isActive as a string", { name: "Ok", isActive: "true" }],
  ])("rejects %s with 400", async (_label, payload) => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await authedRequest(owner, categoriesPath(restaurant.id), {
      method: "POST",
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(400);
  });

  test("unexpected fields are stripped rather than persisted", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const category = await createCategoryAs(owner, restaurant.id, {
      name: "Starters",
      id: "attacker-chosen-id",
      createdAt: "1999-01-01T00:00:00.000Z",
    });

    expect(category.id).not.toBe("attacker-chosen-id");
    const stored = await db.category.findUnique({ where: { id: category.id } });
    expect(stored?.createdAt.getFullYear()).toBeGreaterThan(2000);
  });

  test("a whitespace-only description is stored as null, not as a second kind of empty", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const category = await createCategoryAs(owner, restaurant.id, {
      name: "Starters",
      description: "   ",
    });

    const stored = await db.category.findUnique({ where: { id: category.id } });
    expect(stored?.description).toBeNull();
  });

  test("a malformed category id reads as absent rather than erroring", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await authedRequest(
      owner,
      `${categoriesPath(restaurant.id)}/not-a-real-id`,
    );

    expect(response.status).toBe(404);
  });
});

describe("category item counts", () => {
  /**
   * Regression for a real bug: the console used to count items from a single
   * page of the item list, so any section beyond the API's 100-row page limit
   * reported zero — and the delete confirmation then told an owner a section
   * was empty when it was not. The count now comes from the database.
   */
  test("each category reports how many items it holds", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const starters = await createCategoryAs(owner, restaurant.id, { name: "Starters" });
    const empty = await createCategoryAs(owner, restaurant.id, { name: "Desserts" });

    for (const name of ["Soup", "Bread", "Olives"]) {
      await createMenuItemAs(owner, restaurant.id, {
        categoryId: starters.id,
        name,
        priceMinor: 100,
      });
    }

    const response = await authedRequest(owner, categoriesPath(restaurant.id));
    const body = (await response.json()) as {
      data: { items: { id: string; menuItemCount: number }[] };
    };

    expect(body.data.items.find((c) => c.id === starters.id)?.menuItemCount).toBe(3);
    expect(body.data.items.find((c) => c.id === empty.id)?.menuItemCount).toBe(0);
  });

  test("hidden items still count — an owner needs the real total", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const category = await createCategoryAs(owner, restaurant.id, { name: "Starters" });

    await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Visible",
      priceMinor: 100,
    });
    await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Hidden",
      priceMinor: 100,
      isActive: false,
    });

    const response = await authedRequest(owner, categoriesPath(restaurant.id));
    const body = (await response.json()) as { data: { items: { menuItemCount: number }[] } };

    expect(body.data.items[0]?.menuItemCount).toBe(2);
  });

  /** Prisma's `_count` shape is internal and must not reach the wire. */
  test("the internal _count shape is not exposed", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await createCategoryAs(owner, restaurant.id, { name: "Starters" });

    const raw = await (await authedRequest(owner, categoriesPath(restaurant.id))).text();

    expect(raw).not.toContain("_count");
    expect(raw).toContain("menuItemCount");
  });
});

describe("category ordering", () => {
  /**
   * Menus are curated, not alphabetical. Creation order is the only sensible
   * default, and it must be recorded rather than inferred.
   */
  test("positions are assigned in creation order when not supplied", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const starters = await createCategoryAs(owner, restaurant.id, { name: "Starters" });
    const mains = await createCategoryAs(owner, restaurant.id, { name: "Mains" });
    const desserts = await createCategoryAs(owner, restaurant.id, { name: "Desserts" });

    expect([starters.position, mains.position, desserts.position]).toEqual([0, 1, 2]);
  });

  test("an explicit position is respected and drives the listed order", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    await createCategoryAs(owner, restaurant.id, { name: "Desserts", position: 10 });
    await createCategoryAs(owner, restaurant.id, { name: "Starters", position: 1 });

    const response = await authedRequest(owner, categoriesPath(restaurant.id));
    const body = (await response.json()) as { data: { items: { name: string }[] } };

    expect(body.data.items.map((c) => c.name)).toEqual(["Starters", "Desserts"]);
  });

  test("reordering by PATCH changes the listed order", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const first = await createCategoryAs(owner, restaurant.id, { name: "Starters" });
    await createCategoryAs(owner, restaurant.id, { name: "Mains" });

    await authedRequest(owner, `${categoriesPath(restaurant.id)}/${first.id}`, {
      method: "PATCH",
      body: JSON.stringify({ position: 99 }),
    });

    const response = await authedRequest(owner, categoriesPath(restaurant.id));
    const body = (await response.json()) as { data: { items: { name: string }[] } };

    expect(body.data.items.map((c) => c.name)).toEqual(["Mains", "Starters"]);
  });

  /**
   * `position` is deliberately not unique — a unique constraint would turn
   * every drag-to-reorder into a multi-step dance around conflicts. Ties are
   * therefore possible, and the ordering must still be total and repeatable.
   */
  test("categories sharing a position still have a stable, repeatable order", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    await Promise.all([
      createCategoryAs(owner, restaurant.id, { name: "A", position: 0 }),
      createCategoryAs(owner, restaurant.id, { name: "B", position: 0 }),
      createCategoryAs(owner, restaurant.id, { name: "C", position: 0 }),
    ]);

    const read = async () => {
      const response = await authedRequest(owner, categoriesPath(restaurant.id));
      const body = (await response.json()) as { data: { items: { name: string }[] } };
      return body.data.items.map((c) => c.name);
    };

    const first = await read();
    expect(first).toHaveLength(3);
    expect(await read()).toEqual(first);
    expect(await read()).toEqual(first);
  });

  /**
   * Concurrent creates race for the same "next" position. That must produce a
   * complete, ordered menu — not a lost row and not a 409.
   */
  test("concurrent creates all succeed and none is lost", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const results = await Promise.all(
      ["A", "B", "C", "D", "E"].map((name) =>
        authedRequest(owner, categoriesPath(restaurant.id), {
          method: "POST",
          body: JSON.stringify({ name }),
        }),
      ),
    );

    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(await db.category.count({ where: { restaurantId: restaurant.id } })).toBe(5);
  });
});

describe("category deletion", () => {
  test("an empty category is deleted with 204", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const category = await createCategoryAs(owner, restaurant.id, { name: "Starters" });

    const response = await authedRequest(owner, `${categoriesPath(restaurant.id)}/${category.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(await db.category.count({ where: { id: category.id } })).toBe(0);
  });

  /**
   * The decision this test exists to protect: a category holding dishes is not
   * silently cascaded away. One mis-click must not destroy a whole section.
   */
  test("a category holding menu items is refused with 409 and survives", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const category = await createCategoryAs(owner, restaurant.id, { name: "Starters" });
    await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Soup",
      priceMinor: 500,
    });

    const response = await authedRequest(owner, `${categoriesPath(restaurant.id)}/${category.id}`, {
      method: "DELETE",
    });
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(409);
    expect(body.error.message).toContain("1 menu item");
    expect(await db.category.count({ where: { id: category.id } })).toBe(1);
    expect(await db.menuItem.count({ where: { categoryId: category.id } })).toBe(1);
  });

  test("?force=true deletes the category together with its items", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const category = await createCategoryAs(owner, restaurant.id, { name: "Starters" });
    await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Soup",
      priceMinor: 500,
    });

    const response = await authedRequest(
      owner,
      `${categoriesPath(restaurant.id)}/${category.id}?force=true`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(204);
    expect(await db.category.count({ where: { id: category.id } })).toBe(0);
    expect(await db.menuItem.count({ where: { categoryId: category.id } })).toBe(0);
  });

  test("?force=false is honoured as written rather than read as truthy", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const category = await createCategoryAs(owner, restaurant.id, { name: "Starters" });
    await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Soup",
      priceMinor: 500,
    });

    const response = await authedRequest(
      owner,
      `${categoriesPath(restaurant.id)}/${category.id}?force=false`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(409);
  });

  /** Deleting the restaurant is allowed to take its whole menu with it. */
  test("deleting the restaurant cascades to categories and items", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const category = await createCategoryAs(owner, restaurant.id, { name: "Starters" });
    await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Soup",
      priceMinor: 500,
    });

    const response = await authedRequest(owner, `/admin/restaurants/${restaurant.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(await db.category.count({ where: { restaurantId: restaurant.id } })).toBe(0);
    expect(await db.menuItem.count({ where: { restaurantId: restaurant.id } })).toBe(0);
  });
});

describe("tenant isolation", () => {
  async function twoRestaurants() {
    const [ownerA, ownerB] = await Promise.all([createTestUser(), createTestUser()]);
    const [restaurantA, restaurantB] = await Promise.all([
      createRestaurantAs(ownerA, { name: "Restaurant A" }),
      createRestaurantAs(ownerB, { name: "Restaurant B" }),
    ]);
    const categoryB = await createCategoryAs(ownerB, restaurantB.id, { name: "B Starters" });
    return { ownerA, ownerB, restaurantA, restaurantB, categoryB };
  }

  test("a non-member cannot list another restaurant's categories", async () => {
    const { ownerA, restaurantB } = await twoRestaurants();

    const response = await authedRequest(ownerA, categoriesPath(restaurantB.id));
    expect(response.status).toBe(403);
  });

  test("a non-member cannot create a category in another restaurant", async () => {
    const { ownerA, restaurantB } = await twoRestaurants();

    const response = await authedRequest(ownerA, categoriesPath(restaurantB.id), {
      method: "POST",
      body: JSON.stringify({ name: "Injected" }),
    });

    expect(response.status).toBe(403);
    expect(await db.category.count({ where: { restaurantId: restaurantB.id } })).toBe(1);
  });

  test("a non-member cannot read another restaurant's category by id", async () => {
    const { ownerA, restaurantB, categoryB } = await twoRestaurants();

    const response = await authedRequest(
      ownerA,
      `${categoriesPath(restaurantB.id)}/${categoryB.id}`,
    );
    expect(response.status).toBe(403);
  });

  /**
   * The dangerous shape: a real category id, addressed through a restaurant the
   * caller *is* allowed to manage. Authorization passes; the scoped lookup is
   * what has to refuse it.
   */
  test("a real category id from another restaurant is not reachable through one's own", async () => {
    const { ownerA, restaurantA, categoryB } = await twoRestaurants();

    const read = await authedRequest(ownerA, `${categoriesPath(restaurantA.id)}/${categoryB.id}`);
    expect(read.status).toBe(404);

    const patch = await authedRequest(ownerA, `${categoriesPath(restaurantA.id)}/${categoryB.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Hijacked" }),
    });
    expect(patch.status).toBe(404);

    const remove = await authedRequest(ownerA, `${categoriesPath(restaurantA.id)}/${categoryB.id}`, {
      method: "DELETE",
    });
    expect(remove.status).toBe(404);

    // The refused writes must have changed nothing.
    const stored = await db.category.findUnique({ where: { id: categoryB.id } });
    expect(stored?.name).toBe("B Starters");
  });

  test("a list is scoped to one restaurant even when the user owns several", async () => {
    const owner = await createTestUser();
    const [first, second] = await Promise.all([
      createRestaurantAs(owner, { name: "First" }),
      createRestaurantAs(owner, { name: "Second" }),
    ]);
    await createCategoryAs(owner, first.id, { name: "Only In First" });
    await createCategoryAs(owner, second.id, { name: "Only In Second" });

    const response = await authedRequest(owner, categoriesPath(first.id));
    const body = (await response.json()) as { data: { items: { name: string }[]; total: number } };

    expect(body.data.total).toBe(1);
    expect(body.data.items[0]?.name).toBe("Only In First");
  });
});

describe("STAFF policy", () => {
  async function ownerAndStaff() {
    const { owner, restaurant } = await ownerWithRestaurant();
    const staff = await createTestUser();
    await grantMembership(staff, restaurant.id, "STAFF");
    return { owner, staff, restaurant };
  }

  test("STAFF may read the menu", async () => {
    const { staff, restaurant } = await ownerAndStaff();

    const response = await authedRequest(staff, categoriesPath(restaurant.id));
    expect(response.status).toBe(200);
  });

  test("STAFF may create and update categories — that is the daily work", async () => {
    const { staff, restaurant } = await ownerAndStaff();

    const created = await authedRequest(staff, categoriesPath(restaurant.id), {
      method: "POST",
      body: JSON.stringify({ name: "Specials" }),
    });
    expect(created.status).toBe(201);

    const { data } = (await created.json()) as { data: { id: string } };
    const updated = await authedRequest(staff, `${categoriesPath(restaurant.id)}/${data.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
    });
    expect(updated.status).toBe(200);
  });

  /**
   * Deletion is destructive and staff already have `isActive` to take a section
   * off the menu without losing it, so it mirrors `restaurant:delete`.
   */
  test("STAFF may NOT delete a category", async () => {
    const { owner, staff, restaurant } = await ownerAndStaff();
    const category = await createCategoryAs(owner, restaurant.id, { name: "Starters" });

    const response = await authedRequest(staff, `${categoriesPath(restaurant.id)}/${category.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(await db.category.count({ where: { id: category.id } })).toBe(1);
  });
});

describe("public menu", () => {
  async function publishedMenu() {
    const { owner, restaurant } = await ownerWithRestaurant();
    const starters = await createCategoryAs(owner, restaurant.id, { name: "Starters" });
    const mains = await createCategoryAs(owner, restaurant.id, { name: "Mains" });

    await createMenuItemAs(owner, restaurant.id, {
      categoryId: starters.id,
      name: "Garlic Bread",
      description: "With rosemary",
      priceMinor: 450,
    });
    await createMenuItemAs(owner, restaurant.id, {
      categoryId: mains.id,
      name: "Margherita",
      priceMinor: 1250,
    });

    return { owner, restaurant, starters, mains };
  }

  test("returns categories with their items, in menu order", async () => {
    const { restaurant } = await publishedMenu();

    const response = await app.request(`/restaurants/${restaurant.slug}/menu`);
    const body = (await response.json()) as {
      success: boolean;
      data: { categories: { name: string; menuItems: { name: string }[] }[] };
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.categories.map((c) => c.name)).toEqual(["Starters", "Mains"]);
    expect(body.data.categories[0]?.menuItems.map((i) => i.name)).toEqual(["Garlic Bread"]);
  });

  test("prices are exact minor units carrying their own currency", async () => {
    const { restaurant } = await publishedMenu();

    const response = await app.request(`/restaurants/${restaurant.slug}/menu`);
    const body = (await response.json()) as {
      data: {
        categories: {
          menuItems: { price: { amountMinor: number; currency: string; minorUnits: number } }[];
        }[];
      };
    };

    expect(body.data.categories[0]?.menuItems[0]?.price).toEqual({
      amountMinor: 450,
      currency: "USD",
      minorUnits: 2,
    });
  });

  test("the currency follows the restaurant, so one menu cannot mix currencies", async () => {
    const owner = await createTestUser();
    const restaurant = await createRestaurantAs(owner, { name: "Tokyo Ramen", currency: "JPY" });
    const category = await createCategoryAs(owner, restaurant.id, { name: "Ramen" });
    await createMenuItemAs(owner, restaurant.id, {
      categoryId: category.id,
      name: "Shoyu",
      priceMinor: 1200,
    });

    const response = await app.request(`/restaurants/${restaurant.slug}/menu`);
    const body = (await response.json()) as {
      data: {
        categories: {
          menuItems: { price: { amountMinor: number; currency: string; minorUnits: number } }[];
        }[];
      };
    };

    // 1200 yen, not 12.00 — JPY has no minor unit.
    expect(body.data.categories[0]?.menuItems[0]?.price).toEqual({
      amountMinor: 1200,
      currency: "JPY",
      minorUnits: 0,
    });
  });

  test("hidden categories and hidden items are absent entirely", async () => {
    const { owner, restaurant, starters, mains } = await publishedMenu();

    await authedRequest(owner, `${categoriesPath(restaurant.id)}/${mains.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
    });
    const hidden = await createMenuItemAs(owner, restaurant.id, {
      categoryId: starters.id,
      name: "Retired Dish",
      priceMinor: 100,
      isActive: false,
    });
    expect(hidden.id).toBeDefined();

    const response = await app.request(`/restaurants/${restaurant.slug}/menu`);
    const body = (await response.json()) as {
      data: { categories: { name: string; menuItems: { name: string }[] }[] };
    };

    expect(body.data.categories.map((c) => c.name)).toEqual(["Starters"]);
    expect(body.data.categories[0]?.menuItems.map((i) => i.name)).toEqual(["Garlic Bread"]);
  });

  /**
   * Unavailable is not the same as hidden. A sold-out dish stays on the menu,
   * flagged — removing it makes the customer think the menu is broken.
   */
  test("a sold-out item is still listed, marked unavailable", async () => {
    const { owner, restaurant, starters } = await publishedMenu();

    await createMenuItemAs(owner, restaurant.id, {
      categoryId: starters.id,
      name: "Soup Of The Day",
      priceMinor: 600,
      isAvailable: false,
    });

    const response = await app.request(`/restaurants/${restaurant.slug}/menu`);
    const body = (await response.json()) as {
      data: { categories: { menuItems: { name: string; isAvailable: boolean }[] }[] };
    };
    const soup = body.data.categories[0]?.menuItems.find((i) => i.name === "Soup Of The Day");

    expect(soup).toBeDefined();
    expect(soup?.isAvailable).toBe(false);
  });

  test("an empty menu is an empty list, not an error", async () => {
    const { restaurant } = await ownerWithRestaurant();

    const response = await app.request(`/restaurants/${restaurant.slug}/menu`);
    const body = (await response.json()) as { data: { categories: unknown[] } };

    expect(response.status).toBe(200);
    expect(body.data.categories).toEqual([]);
  });

  /**
   * Internal bookkeeping has no place on a customer's phone, and `isActive`
   * in particular would tell an observer that hidden content exists.
   */
  test("no internal or administrative fields are exposed", async () => {
    const { restaurant } = await publishedMenu();

    const response = await app.request(`/restaurants/${restaurant.slug}/menu`);
    const raw = await response.text();

    for (const field of [
      "isActive",
      "restaurantId",
      "categoryId",
      "position",
      "createdAt",
      "updatedAt",
      "priceMinor",
      "membership",
      "userId",
    ]) {
      expect(raw).not.toContain(field);
    }
  });

  test("a deactivated restaurant's menu is not readable", async () => {
    const { owner, restaurant } = await publishedMenu();

    await authedRequest(owner, `/admin/restaurants/${restaurant.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
    });

    const response = await app.request(`/restaurants/${restaurant.slug}/menu`);
    expect(response.status).toBe(404);
  });

  test("an unknown slug is a 404, indistinguishable from a deactivated one", async () => {
    const response = await app.request("/restaurants/no-such-restaurant/menu");
    expect(response.status).toBe(404);
  });

  test("one restaurant's menu never contains another's items", async () => {
    const { restaurant } = await publishedMenu();
    const otherOwner: TestUser = await createTestUser();
    const other = await createRestaurantAs(otherOwner, { name: "Corner Cafe" });
    const otherCategory = await createCategoryAs(otherOwner, other.id, { name: "Secret Menu" });
    await createMenuItemAs(otherOwner, other.id, {
      categoryId: otherCategory.id,
      name: "Not Yours",
      priceMinor: 999,
    });

    const response = await app.request(`/restaurants/${restaurant.slug}/menu`);
    const raw = await response.text();

    expect(raw).not.toContain("Secret Menu");
    expect(raw).not.toContain("Not Yours");
  });

  test("the menu read requires no authentication", async () => {
    const { restaurant } = await publishedMenu();

    const response = await app.request(`/restaurants/${restaurant.slug}/menu`);
    expect(response.status).toBe(200);
  });
});
