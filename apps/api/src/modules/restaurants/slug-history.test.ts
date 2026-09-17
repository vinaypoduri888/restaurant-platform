import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@repo/database";
import { app } from "../../app.ts";
import {
  authedRequest,
  createRestaurantAs,
  createTestUser,
  grantMembership,
  resetDatabase,
  type TestUser,
} from "../../test-support/helpers.ts";

/**
 * Slug lifecycle: a restaurant may rename its public URL, and every URL it has
 * ever had keeps working.
 *
 * The reason this exists at all is physical. A QR code is printed and glued to
 * a table; the URL it carries cannot be edited afterwards. So a rename must not
 * break it, and — just as important — the retired URL must stay reserved, or a
 * later restaurant could claim it and silently inherit another's customers.
 */

let owner: TestUser;

beforeEach(async () => {
  await resetDatabase();
  owner = await createTestUser();
});

/** The slugs recorded for a restaurant, as the database holds them. */
async function reservedSlugs(restaurantId: string): Promise<string[]> {
  const rows = await db.restaurantSlug.findMany({
    where: { restaurantId },
    select: { slug: true },
    orderBy: { slug: "asc" },
  });
  return rows.map((row) => row.slug);
}

function patchSlug(user: TestUser, id: string, slug: string) {
  return authedRequest(user, `/admin/restaurants/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ slug }),
  });
}

describe("the initial slug", () => {
  test("is reserved when the restaurant is created", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });

    expect(restaurant.slug).toBe("spice-house");
    expect(await reservedSlugs(restaurant.id)).toEqual(["spice-house"]);
  });

  /**
   * The reservation is what makes the uniqueness guarantee real. A restaurant
   * whose current slug is absent from the registry is a hole in it: another
   * restaurant could claim that slug and nothing would object.
   */
  test("is reserved even when the slug was supplied rather than derived", async () => {
    const restaurant = await createRestaurantAs(owner, {
      name: "Spice House",
      slug: "custom-choice",
    });

    expect(await reservedSlugs(restaurant.id)).toEqual(["custom-choice"]);
  });

  test("is rolled back with the restaurant if creation fails", async () => {
    await createRestaurantAs(owner, { name: "First", slug: "taken-slug" });

    const response = await authedRequest(owner, "/admin/restaurants", {
      method: "POST",
      body: JSON.stringify({ name: "Second", slug: "taken-slug" }),
    });

    expect(response.status).toBe(409);
    // Exactly one reservation for that slug — the failed attempt left nothing.
    expect(await db.restaurantSlug.count({ where: { slug: "taken-slug" } })).toBe(1);
    expect(await db.restaurant.count()).toBe(1);
  });
});

describe("changing the slug", () => {
  test("updates the current slug and keeps the old one reserved", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "My Restaurant" });
    expect(restaurant.slug).toBe("my-restaurant");

    const response = await patchSlug(owner, restaurant.id, "spice-house");
    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: { slug: string } };
    expect(body.data.slug).toBe("spice-house");

    // Both, not just the new one.
    expect(await reservedSlugs(restaurant.id)).toEqual(["my-restaurant", "spice-house"]);
  });

  test("goes through the existing update contract, alongside other fields", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "My Restaurant" });

    const response = await authedRequest(owner, `/admin/restaurants/${restaurant.id}`, {
      method: "PATCH",
      body: JSON.stringify({ slug: "spice-house", city: "Mumbai", name: "Spice House" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { slug: string; city: string; name: string };
    };

    // A slug change is not a special endpoint that ignores the rest of the body.
    expect(body.data).toMatchObject({ slug: "spice-house", city: "Mumbai", name: "Spice House" });
  });

  test("can be done repeatedly, and every slug stays reserved", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "One" });

    expect((await patchSlug(owner, restaurant.id, "two")).status).toBe(200);
    expect((await patchSlug(owner, restaurant.id, "three")).status).toBe(200);

    expect(await reservedSlugs(restaurant.id)).toEqual(["one", "three", "two"]);
  });

  /**
   * A reverted rename. This is the case that rules out a permanent redirect on
   * the public page: a slug can become current again, so a browser that had
   * cached a 308 would be stranded.
   */
  test("a restaurant may reclaim a slug it used to hold", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Original" });

    expect((await patchSlug(owner, restaurant.id, "renamed")).status).toBe(200);
    expect((await patchSlug(owner, restaurant.id, "original")).status).toBe(200);

    // Reclaimed, not duplicated.
    expect(await reservedSlugs(restaurant.id)).toEqual(["original", "renamed"]);
    expect(await db.restaurantSlug.count({ where: { slug: "original" } })).toBe(1);
  });

  test("setting the slug to its current value is a no-op, not a conflict", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Steady" });

    expect((await patchSlug(owner, restaurant.id, "steady")).status).toBe(200);
    expect(await reservedSlugs(restaurant.id)).toEqual(["steady"]);
  });

  test("an update that does not mention the slug leaves it alone", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Unchanged" });

    const response = await authedRequest(owner, `/admin/restaurants/${restaurant.id}`, {
      method: "PATCH",
      body: JSON.stringify({ city: "Delhi" }),
    });

    expect(response.status).toBe(200);
    expect(await reservedSlugs(restaurant.id)).toEqual(["unchanged"]);
  });
});

describe("slug uniqueness", () => {
  test("a slug currently in use by another restaurant is refused", async () => {
    const mine = await createRestaurantAs(owner, { name: "Mine" });
    await createRestaurantAs(owner, { name: "Theirs" });

    const response = await patchSlug(owner, mine.id, "theirs");

    expect(response.status).toBe(409);
    expect(await reservedSlugs(mine.id)).toEqual(["mine"]);
  });

  /**
   * The invariant this whole design exists for. "Available" has to mean "never
   * claimed by anyone", not "not currently in use" — otherwise a rename frees
   * a slug that printed codes still point at, and the next restaurant to take
   * it inherits those scans.
   */
  test("a slug another restaurant has RETIRED is still refused", async () => {
    const theirs = await createRestaurantAs(owner, { name: "Theirs" });
    expect((await patchSlug(owner, theirs.id, "moved-on")).status).toBe(200);

    // "theirs" is now retired — free by a naive reading, reserved in fact.
    const mine = await createRestaurantAs(owner, { name: "Mine" });
    const response = await patchSlug(owner, mine.id, "theirs");

    expect(response.status).toBe(409);
    expect(await reservedSlugs(mine.id)).toEqual(["mine"]);
  });

  test("a retired slug cannot be claimed at creation time either", async () => {
    const theirs = await createRestaurantAs(owner, { name: "Theirs" });
    expect((await patchSlug(owner, theirs.id, "moved-on")).status).toBe(200);

    const response = await authedRequest(owner, "/admin/restaurants", {
      method: "POST",
      body: JSON.stringify({ name: "Newcomer", slug: "theirs" }),
    });

    expect(response.status).toBe(409);
  });

  test("the conflict message does not reveal which restaurant holds the slug", async () => {
    const theirs = await createRestaurantAs(owner, { name: "Secret Cafe" });
    const mine = await createRestaurantAs(owner, { name: "Mine" });

    const response = await patchSlug(owner, mine.id, theirs.slug);
    const body = (await response.json()) as { error: { message: string } };

    expect(body.error.message).toContain("already in use");
    expect(body.error.message).not.toContain("Secret");
    expect(body.error.message).not.toContain(theirs.id);
  });

  /**
   * Attempts a reservation and returns the error it produced.
   *
   * Written as an explicit try/catch rather than `expect(...).rejects`: the
   * matcher hangs on a `PrismaClientKnownRequestError` in this Bun version
   * (the promise settles in milliseconds, but the assertion never returns), and
   * a test that hangs is worse than one that reads slightly longer. This also
   * makes the assertion say what it means — the write must be *refused*.
   */
  async function expectReservationRefused(restaurantId: string, slug: string): Promise<void> {
    let refused = false;

    try {
      await db.restaurantSlug.create({ data: { restaurantId, slug } });
    } catch {
      refused = true;
    }

    expect(refused).toBe(true);
  }

  /** The database is the guarantee, not the service's pre-flight check. */
  test("PostgreSQL refuses a duplicate reservation directly", async () => {
    const first = await createRestaurantAs(owner, { name: "First" });
    const second = await createRestaurantAs(owner, { name: "Second" });

    await expectReservationRefused(second.id, first.slug);
  });

  /**
   * A slug becomes a URL path segment, so the shape is enforced in PostgreSQL
   * as well as in Zod. Validation is the first barrier; this is the one that
   * holds if a future write path forgets to validate.
   */
  test("PostgreSQL refuses a slug that could escape the URL path", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Safe" });

    for (const hostile of ["../admin", "a/b", "A-B", "trailing-", "has space", "%2e%2e"]) {
      await expectReservationRefused(restaurant.id, hostile);
    }
  });

  test("the API rejects a malformed slug before it reaches the database", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Safe" });

    for (const hostile of ["../admin", "a/b", "spaced out", "", "-leading", "double--hyphen-"]) {
      const response = await patchSlug(owner, restaurant.id, hostile);
      expect(response.status).toBe(400);
    }

    expect(await reservedSlugs(restaurant.id)).toEqual(["safe"]);
  });

  /**
   * Case is normalised rather than refused — `slugSchema` lowercases before it
   * validates. Worth pinning: it means `Spice-House` is accepted and stored as
   * `spice-house`, so an owner who types capitals gets a working URL instead of
   * a validation error, and the database `CHECK` still only ever sees lowercase.
   */
  test("an uppercase slug is normalised, not rejected", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Safe" });

    const response = await patchSlug(owner, restaurant.id, "Spice-HOUSE");
    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: { slug: string } };
    expect(body.data.slug).toBe("spice-house");
    expect(await reservedSlugs(restaurant.id)).toEqual(["safe", "spice-house"]);
  });
});

describe("public resolution", () => {
  test("the current slug resolves", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });

    const response = await app.request(`/restaurants/${restaurant.slug}`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: { slug: string; name: string } };
    expect(body.data).toMatchObject({ slug: "spice-house", name: "Spice House" });
  });

  /** The point of the whole feature: a printed code keeps working. */
  test("a retired slug resolves to the same restaurant", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "My Restaurant" });
    await patchSlug(owner, restaurant.id, "spice-house");

    const response = await app.request("/restaurants/my-restaurant");
    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: { id: string; slug: string } };
    expect(body.data.id).toBe(restaurant.id);
  });

  /**
   * How a caller knows to redirect. No dedicated field marks it — the response
   * simply always reports the current slug, so a mismatch with what was asked
   * for *is* the signal.
   */
  test("the response always reports the CURRENT slug, whichever was requested", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "My Restaurant" });
    await patchSlug(owner, restaurant.id, "spice-house");

    const viaOld = (await (await app.request("/restaurants/my-restaurant")).json()) as {
      data: { slug: string };
    };
    const viaNew = (await (await app.request("/restaurants/spice-house")).json()) as {
      data: { slug: string };
    };

    expect(viaOld.data.slug).toBe("spice-house");
    expect(viaNew.data.slug).toBe("spice-house");
  });

  test("the menu also resolves through a retired slug", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "My Restaurant" });
    await patchSlug(owner, restaurant.id, "spice-house");

    const response = await app.request("/restaurants/my-restaurant/menu");
    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: { restaurant: { slug: string } } };
    expect(body.data.restaurant.slug).toBe("spice-house");
  });

  test("an unknown slug is still a 404", async () => {
    await createRestaurantAs(owner, { name: "Exists" });

    expect((await app.request("/restaurants/never-existed")).status).toBe(404);
  });

  /**
   * A retired slug must not leak that a restaurant was hidden. Deactivated and
   * never-existed have to be indistinguishable, on old URLs as on current ones.
   */
  test("a retired slug of a deactivated restaurant is a 404, like any unknown slug", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Closing Down" });
    await patchSlug(owner, restaurant.id, "renamed-then-hidden");

    await authedRequest(owner, `/admin/restaurants/${restaurant.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
    });

    const viaOld = await app.request("/restaurants/closing-down");
    const viaNew = await app.request("/restaurants/renamed-then-hidden");
    const unknown = await app.request("/restaurants/never-existed");

    expect(viaOld.status).toBe(404);
    expect(viaNew.status).toBe(404);
    expect(unknown.status).toBe(404);

    // The messages must be indistinguishable apart from the slug echoed back,
    // which the caller already knew. Nothing may hint that one of these slugs
    // is attached to a real-but-hidden restaurant.
    const messageFor = async (response: Response) => {
      const body = (await response.json()) as { error: { message: string } };
      return body.error.message.replace(/"[^"]*"/, '"<slug>"');
    };

    // Each body is read once — a Response body cannot be consumed twice.
    const unknownMessage = await messageFor(unknown);

    expect(await messageFor(viaOld)).toBe(unknownMessage);
    expect(await messageFor(viaNew)).toBe(unknownMessage);
  });

  test("no internal id is exposed by resolving a retired slug", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "My Restaurant" });
    await patchSlug(owner, restaurant.id, "spice-house");

    const text = await (await app.request("/restaurants/my-restaurant")).text();

    // The id *is* returned as `id` — that is the pre-existing public contract —
    // but nothing about the slug registry leaks.
    expect(text).not.toContain("restaurantSlug");
    expect(text).not.toContain("restaurant_slugs");
    expect(text).not.toContain("slugHistory");
  });
});

describe("authorization", () => {
  test("a non-member cannot change a slug", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Mine" });
    const stranger = await createTestUser();

    const response = await patchSlug(stranger, restaurant.id, "hijacked");

    expect(response.status).toBe(403);
    expect(await reservedSlugs(restaurant.id)).toEqual(["mine"]);
  });

  test("an anonymous caller cannot change a slug", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Mine" });

    const response = await app.request(`/admin/restaurants/${restaurant.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "hijacked" }),
    });

    expect(response.status).toBe(401);
    expect(await reservedSlugs(restaurant.id)).toEqual(["mine"]);
  });

  /**
   * STAFF holds `restaurant:update`, which is the capability that governs
   * editing a restaurant's fields — and a slug is one of its fields. This
   * phase does not narrow that: nothing is lost if staff rename, because the
   * old URL keeps working.
   */
  test("STAFF may rename, because STAFF holds restaurant:update", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Mine" });
    const staff = await createTestUser();
    await grantMembership(staff, restaurant.id, "STAFF");

    const response = await patchSlug(staff, restaurant.id, "staff-renamed");

    expect(response.status).toBe(200);
    expect(await reservedSlugs(restaurant.id)).toEqual(["mine", "staff-renamed"]);
  });

  test("there is no endpoint for editing slug history directly", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Mine" });

    for (const [method, path] of [
      ["GET", `/admin/restaurants/${restaurant.id}/slugs`],
      ["POST", `/admin/restaurants/${restaurant.id}/slugs`],
      ["DELETE", `/admin/restaurants/${restaurant.id}/slugs/mine`],
    ] as const) {
      const response = await authedRequest(owner, path, { method });
      expect(response.status).toBe(404);
    }
  });
});

describe("deleting a restaurant", () => {
  test("releases its reserved slugs", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Temporary" });
    await patchSlug(owner, restaurant.id, "renamed");

    const response = await authedRequest(owner, `/admin/restaurants/${restaurant.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(204);

    // The cascade takes the reservations with the restaurant. A slug held by a
    // restaurant that no longer exists cannot strand anyone's printed code,
    // because the page it pointed at is gone either way.
    expect(await db.restaurantSlug.count({ where: { restaurantId: restaurant.id } })).toBe(0);
  });

  test("so the slug becomes available again", async () => {
    const first = await createRestaurantAs(owner, { name: "Recycled" });
    await authedRequest(owner, `/admin/restaurants/${first.id}`, { method: "DELETE" });

    const second = await createRestaurantAs(owner, { name: "Recycled" });
    expect(second.slug).toBe("recycled");
  });
});
