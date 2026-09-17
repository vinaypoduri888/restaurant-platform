import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@repo/database";
import { DAYS_OF_WEEK } from "@repo/validation/operating-hours";
import { app } from "../../app.ts";
import {
  authedRequest,
  createRestaurantAs,
  createTestUser,
  grantMembership,
  resetDatabase,
  type TestUser,
} from "../../test-support/helpers.ts";

beforeEach(async () => {
  await resetDatabase();
});

const at = (hour: number, minute = 0) => hour * 60 + minute;

/** A full week, closed unless overridden — the shape the API requires. */
function week(overrides: Record<string, { opensAt: number; closesAt: number }> = {}) {
  return {
    days: DAYS_OF_WEEK.map((dayOfWeek) => {
      const override = overrides[dayOfWeek];
      return override
        ? { dayOfWeek, isClosed: false, ...override }
        : { dayOfWeek, isClosed: true };
    }),
  };
}

function hoursPath(restaurantId: string) {
  return `/admin/restaurants/${restaurantId}/hours`;
}

async function ownerWithRestaurant(overrides: Record<string, unknown> = {}) {
  const owner = await createTestUser();
  const restaurant = await createRestaurantAs(owner, { name: "Pizza Palace", ...overrides });
  return { owner, restaurant };
}

interface HoursResponse {
  success: boolean;
  data: {
    days: {
      dayOfWeek: string;
      isClosed: boolean;
      opensAt: number | null;
      closesAt: number | null;
      isOvernight: boolean;
    }[];
  };
}

describe("authentication", () => {
  test.each([
    ["GET", undefined],
    ["PUT", JSON.stringify(week())],
  ])("%s hours rejects anonymous callers with 401", async (method, body) => {
    const response = await app.request(hoursPath("some-restaurant"), {
      method,
      ...(body ? { headers: { "Content-Type": "application/json" }, body } : {}),
    });

    expect(response.status).toBe(401);
  });
});

describe("reading hours", () => {
  /**
   * The editor renders a row per day, so the read is padded to a complete week
   * rather than returning only what happens to be stored.
   */
  test("an unconfigured restaurant reads as seven closed days", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await authedRequest(owner, hoursPath(restaurant.id));
    const body = (await response.json()) as HoursResponse;

    expect(response.status).toBe(200);
    expect(body.data.days).toHaveLength(7);
    expect(body.data.days.map((day) => day.dayOfWeek)).toEqual([...DAYS_OF_WEEK]);
    expect(body.data.days.every((day) => day.isClosed)).toBe(true);
  });

  test("days come back in reading order, Monday first", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await authedRequest(owner, hoursPath(restaurant.id), {
      method: "PUT",
      body: JSON.stringify(week({ SUNDAY: { opensAt: at(10), closesAt: at(16) } })),
    });

    const response = await authedRequest(owner, hoursPath(restaurant.id));
    const body = (await response.json()) as HoursResponse;

    expect(body.data.days.map((day) => day.dayOfWeek)).toEqual([...DAYS_OF_WEEK]);
  });
});

describe("writing hours", () => {
  test("stores a normal week and reads it back unchanged", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await authedRequest(owner, hoursPath(restaurant.id), {
      method: "PUT",
      body: JSON.stringify(
        week({
          MONDAY: { opensAt: at(9), closesAt: at(17) },
          TUESDAY: { opensAt: at(9), closesAt: at(17) },
        }),
      ),
    });
    const body = (await response.json()) as HoursResponse;

    expect(response.status).toBe(200);
    const monday = body.data.days.find((day) => day.dayOfWeek === "MONDAY");
    expect(monday).toMatchObject({ isClosed: false, opensAt: 540, closesAt: 1020, isOvernight: false });
  });

  /**
   * An overnight period stays one period. It must not be split into two rows,
   * nor rewritten as 22:00–23:59 plus 00:00–02:00.
   */
  test("an overnight period is stored as a single row and flagged", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await authedRequest(owner, hoursPath(restaurant.id), {
      method: "PUT",
      body: JSON.stringify(week({ FRIDAY: { opensAt: at(22), closesAt: at(2) } })),
    });
    const body = (await response.json()) as HoursResponse;

    const friday = body.data.days.find((day) => day.dayOfWeek === "FRIDAY");
    expect(friday).toMatchObject({ opensAt: 1320, closesAt: 120, isOvernight: true });

    // One row for Friday, not two, and no fabricated Saturday entry.
    const stored = await db.operatingHours.findMany({ where: { restaurantId: restaurant.id } });
    expect(stored.filter((row) => row.dayOfWeek === "FRIDAY")).toHaveLength(1);
    expect(stored).toHaveLength(7);
  });

  test("a closed day stores no times at all", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    await authedRequest(owner, hoursPath(restaurant.id), {
      method: "PUT",
      body: JSON.stringify(week({ MONDAY: { opensAt: at(9), closesAt: at(17) } })),
    });

    const sunday = await db.operatingHours.findFirst({
      where: { restaurantId: restaurant.id, dayOfWeek: "SUNDAY" },
    });

    expect(sunday?.isClosed).toBe(true);
    expect(sunday?.opensAt).toBeNull();
    expect(sunday?.closesAt).toBeNull();
  });

  /** Replacing the week is idempotent and never accumulates duplicate rows. */
  test("writing twice leaves exactly seven rows", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    for (const opens of [at(9), at(10)]) {
      await authedRequest(owner, hoursPath(restaurant.id), {
        method: "PUT",
        body: JSON.stringify(week({ MONDAY: { opensAt: opens, closesAt: at(17) } })),
      });
    }

    expect(await db.operatingHours.count({ where: { restaurantId: restaurant.id } })).toBe(7);
    const monday = await db.operatingHours.findFirst({
      where: { restaurantId: restaurant.id, dayOfWeek: "MONDAY" },
    });
    expect(monday?.opensAt).toBe(at(10));
  });

  test("deleting the restaurant removes its hours", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await authedRequest(owner, hoursPath(restaurant.id), {
      method: "PUT",
      body: JSON.stringify(week({ MONDAY: { opensAt: at(9), closesAt: at(17) } })),
    });

    await authedRequest(owner, `/admin/restaurants/${restaurant.id}`, { method: "DELETE" });

    expect(await db.operatingHours.count({ where: { restaurantId: restaurant.id } })).toBe(0);
  });
});

describe("hours validation", () => {
  async function put(user: TestUser, restaurantId: string, payload: unknown) {
    return authedRequest(user, hoursPath(restaurantId), {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  test.each([
    ["a negative minute", week({ MONDAY: { opensAt: -1, closesAt: at(17) } })],
    ["a minute past 23:59", week({ MONDAY: { opensAt: at(9), closesAt: 1440 } })],
    ["a fractional minute", week({ MONDAY: { opensAt: 540.5, closesAt: at(17) } })],
    ["a time sent as a string", week({ MONDAY: { opensAt: "09:00" as never, closesAt: at(17) } })],
    ["equal opening and closing times", week({ MONDAY: { opensAt: at(9), closesAt: at(9) } })],
  ])("rejects %s with 400", async (_label, payload) => {
    const { owner, restaurant } = await ownerWithRestaurant();
    expect((await put(owner, restaurant.id, payload)).status).toBe(400);
  });

  test("rejects a week that is missing a day", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const incomplete = { days: week().days.slice(0, 6) };

    expect((await put(owner, restaurant.id, incomplete)).status).toBe(400);
  });

  test("rejects a duplicated day", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const duplicated = { days: [...week().days.slice(0, 6), week().days[0]] };

    expect((await put(owner, restaurant.id, duplicated)).status).toBe(400);
  });

  test("rejects an unknown day name", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const bogus = { days: [...week().days.slice(0, 6), { dayOfWeek: "CATURDAY", isClosed: true }] };

    expect((await put(owner, restaurant.id, bogus)).status).toBe(400);
  });

  /** Closed and "open at these times" are mutually exclusive states. */
  test("rejects a closed day that also carries times", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const contradictory = {
      days: DAYS_OF_WEEK.map((dayOfWeek) => ({
        dayOfWeek,
        isClosed: true,
        opensAt: at(9),
        closesAt: at(17),
      })),
    };

    expect((await put(owner, restaurant.id, contradictory)).status).toBe(400);
  });

  test("rejects an open day missing its closing time", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const halfConfigured = {
      days: DAYS_OF_WEEK.map((dayOfWeek) => ({ dayOfWeek, isClosed: false, opensAt: at(9) })),
    };

    expect((await put(owner, restaurant.id, halfConfigured)).status).toBe(400);
  });

  /** A rejected write must leave the previous schedule intact. */
  test("an invalid write does not disturb the stored week", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await put(owner, restaurant.id, week({ MONDAY: { opensAt: at(9), closesAt: at(17) } }));

    await put(owner, restaurant.id, week({ MONDAY: { opensAt: -5, closesAt: at(17) } }));

    const monday = await db.operatingHours.findFirst({
      where: { restaurantId: restaurant.id, dayOfWeek: "MONDAY" },
    });
    expect(monday?.opensAt).toBe(at(9));
  });
});

describe("time zone validation", () => {
  test("accepts a valid IANA identifier", async () => {
    const owner = await createTestUser();
    const restaurant = await createRestaurantAs(owner, {
      name: "Kolkata Kitchen",
      timeZone: "Asia/Kolkata",
    });

    const stored = await db.restaurant.findUnique({ where: { id: restaurant.id } });
    expect(stored?.timeZone).toBe("Asia/Kolkata");
  });

  test("defaults to UTC when not supplied", async () => {
    const { restaurant } = await ownerWithRestaurant();

    const stored = await db.restaurant.findUnique({ where: { id: restaurant.id } });
    expect(stored?.timeZone).toBe("UTC");
  });

  /**
   * A fixed offset cannot express daylight saving, so it is not a valid zone —
   * accepting one would make a New York restaurant an hour wrong for half the
   * year.
   */
  test.each([
    ["a fixed UTC offset", "+05:30"],
    ["a made-up zone", "Mars/Olympus_Mons"],
    ["an empty string", ""],
    ["a plain city name", "Kolkata"],
  ])("rejects %s with 400", async (_label, timeZone) => {
    const owner = await createTestUser();

    const response = await authedRequest(owner, "/admin/restaurants", {
      method: "POST",
      body: JSON.stringify({ name: "Bad Zone", timeZone }),
    });

    expect(response.status).toBe(400);
  });

  test("the time zone can be changed through the existing restaurant update", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await authedRequest(owner, `/admin/restaurants/${restaurant.id}`, {
      method: "PATCH",
      body: JSON.stringify({ timeZone: "Europe/Amsterdam" }),
    });

    expect(response.status).toBe(200);
    const stored = await db.restaurant.findUnique({ where: { id: restaurant.id } });
    expect(stored?.timeZone).toBe("Europe/Amsterdam");
  });
});

describe("authorization", () => {
  async function ownerAndStaff() {
    const { owner, restaurant } = await ownerWithRestaurant();
    const staff = await createTestUser();
    await grantMembership(staff, restaurant.id, "STAFF");
    return { owner, staff, restaurant };
  }

  test("OWNER can read and write hours", async () => {
    const { owner, restaurant } = await ownerAndStaff();

    expect((await authedRequest(owner, hoursPath(restaurant.id))).status).toBe(200);
    expect(
      (
        await authedRequest(owner, hoursPath(restaurant.id), {
          method: "PUT",
          body: JSON.stringify(week({ MONDAY: { opensAt: at(9), closesAt: at(17) } })),
        })
      ).status,
    ).toBe(200);
  });

  /**
   * Hours are restaurant profile data, so they follow `restaurant:update` — the
   * capability STAFF already holds for the rest of the profile. No new
   * capability was invented for this phase.
   */
  test("STAFF can read and write hours, matching the existing profile policy", async () => {
    const { staff, restaurant } = await ownerAndStaff();

    expect((await authedRequest(staff, hoursPath(restaurant.id))).status).toBe(200);
    expect(
      (
        await authedRequest(staff, hoursPath(restaurant.id), {
          method: "PUT",
          body: JSON.stringify(week({ MONDAY: { opensAt: at(10), closesAt: at(18) } })),
        })
      ).status,
    ).toBe(200);
  });
});

describe("tenant isolation", () => {
  async function twoRestaurants() {
    const { owner: ownerA, restaurant: restaurantA } = await ownerWithRestaurant({
      name: "Restaurant A",
    });
    const ownerB = await createTestUser();
    const restaurantB = await createRestaurantAs(ownerB, { name: "Restaurant B" });

    await authedRequest(ownerB, hoursPath(restaurantB.id), {
      method: "PUT",
      body: JSON.stringify(week({ MONDAY: { opensAt: at(9), closesAt: at(17) } })),
    });

    return { ownerA, restaurantA, ownerB, restaurantB };
  }

  test("a non-member cannot read another restaurant's hours", async () => {
    const { ownerA, restaurantB } = await twoRestaurants();

    expect((await authedRequest(ownerA, hoursPath(restaurantB.id))).status).toBe(403);
  });

  /** The important one: a refused write must change nothing. */
  test("a non-member cannot overwrite another restaurant's hours", async () => {
    const { ownerA, restaurantB } = await twoRestaurants();

    const response = await authedRequest(ownerA, hoursPath(restaurantB.id), {
      method: "PUT",
      body: JSON.stringify(week({ MONDAY: { opensAt: at(1), closesAt: at(2) } })),
    });

    expect(response.status).toBe(403);

    const monday = await db.operatingHours.findFirst({
      where: { restaurantId: restaurantB.id, dayOfWeek: "MONDAY" },
    });
    expect(monday?.opensAt).toBe(at(9));
  });

  test("a nonexistent restaurant is answered like a forbidden one", async () => {
    const owner = await createTestUser();

    expect((await authedRequest(owner, hoursPath("cmnonexistentid00000000"))).status).toBe(403);
  });

  /**
   * The restaurant is taken from the authorized path, so a body field naming
   * another tenant has nowhere to take effect.
   */
  test("a restaurantId in the body cannot redirect the write", async () => {
    const { ownerA, restaurantA, restaurantB } = await twoRestaurants();

    await authedRequest(ownerA, hoursPath(restaurantA.id), {
      method: "PUT",
      body: JSON.stringify({
        restaurantId: restaurantB.id,
        ...week({ TUESDAY: { opensAt: at(8), closesAt: at(12) } }),
      }),
    });

    const tuesdayA = await db.operatingHours.findFirst({
      where: { restaurantId: restaurantA.id, dayOfWeek: "TUESDAY" },
    });
    const tuesdayB = await db.operatingHours.findFirst({
      where: { restaurantId: restaurantB.id, dayOfWeek: "TUESDAY" },
    });

    expect(tuesdayA?.opensAt).toBe(at(8));
    expect(tuesdayB?.isClosed).toBe(true);
  });

  test("one restaurant's hours never appear in another's", async () => {
    const { ownerA, restaurantA } = await twoRestaurants();

    const response = await authedRequest(ownerA, hoursPath(restaurantA.id));
    const body = (await response.json()) as HoursResponse;

    expect(body.data.days.every((day) => day.isClosed)).toBe(true);
  });
});

describe("public restaurant response", () => {
  /** Everything the public contract carried before this phase must survive. */
  test("existing public fields are unchanged", async () => {
    const owner = await createTestUser();
    const restaurant = await createRestaurantAs(owner, {
      name: "Pizza Palace",
      description: "Wood-fired",
      address: "12 Market Street",
      city: "Mumbai",
      country: "India",
      currency: "INR",
      timeZone: "Asia/Kolkata",
    });

    const response = await app.request(`/restaurants/${restaurant.slug}`);
    const body = (await response.json()) as { data: Record<string, unknown> };

    for (const field of [
      "id",
      "name",
      "slug",
      "description",
      "address",
      "city",
      "country",
      "currency",
    ]) {
      expect(body.data).toHaveProperty(field);
    }
    expect(body.data.currency).toBe("INR");
  });

  test("the public response now carries the time zone, hours and status", async () => {
    const owner = await createTestUser();
    const restaurant = await createRestaurantAs(owner, {
      name: "Pizza Palace",
      timeZone: "Asia/Kolkata",
    });
    await authedRequest(owner, hoursPath(restaurant.id), {
      method: "PUT",
      body: JSON.stringify(week({ MONDAY: { opensAt: at(9), closesAt: at(17) } })),
    });

    const response = await app.request(`/restaurants/${restaurant.slug}`);
    const body = (await response.json()) as {
      data: { timeZone: string; status: string; hours: { dayOfWeek: string }[] };
    };

    expect(body.data.timeZone).toBe("Asia/Kolkata");
    expect(body.data.hours).toHaveLength(7);
    expect(["open", "closed", "unknown"]).toContain(body.data.status);
  });

  /**
   * A restaurant whose owner has not filled the form in is not closed — telling
   * a customer it is would turn an empty admin field into a lost visit.
   */
  test("an unconfigured restaurant reports status unknown and no hours", async () => {
    const { restaurant } = await ownerWithRestaurant();

    const response = await app.request(`/restaurants/${restaurant.slug}`);
    const body = (await response.json()) as { data: { status: string; hours: unknown[] } };

    expect(body.data.status).toBe("unknown");
    expect(body.data.hours).toEqual([]);
  });

  test("no administrative or internal field leaks into the public response", async () => {
    const owner = await createTestUser();
    const restaurant = await createRestaurantAs(owner, {
      name: "Pizza Palace",
      email: "owner@example.test",
      phone: "+1 555 0100",
    });
    await authedRequest(owner, hoursPath(restaurant.id), {
      method: "PUT",
      body: JSON.stringify(week({ MONDAY: { opensAt: at(9), closesAt: at(17) } })),
    });

    const raw = await (await app.request(`/restaurants/${restaurant.slug}`)).text();

    for (const leak of [
      "owner@example.test",
      "555 0100",
      "isActive",
      "restaurantId",
      "createdAt",
      "updatedAt",
      "userId",
      "membership",
    ]) {
      expect(raw).not.toContain(leak);
    }
  });

  test("the public list endpoint is unchanged and carries no hours", async () => {
    const owner = await createTestUser();
    const restaurant = await createRestaurantAs(owner, { name: "Pizza Palace" });
    await authedRequest(owner, hoursPath(restaurant.id), {
      method: "PUT",
      body: JSON.stringify(week({ MONDAY: { opensAt: at(9), closesAt: at(17) } })),
    });

    const response = await app.request("/restaurants");
    const body = (await response.json()) as { data: { items: Record<string, unknown>[] } };

    expect(body.data.items[0]).toHaveProperty("name");
    expect(body.data.items[0]).not.toHaveProperty("hours");
    expect(body.data.items[0]).not.toHaveProperty("status");
  });

  test("a deactivated restaurant still 404s rather than exposing hours", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await authedRequest(owner, hoursPath(restaurant.id), {
      method: "PUT",
      body: JSON.stringify(week({ MONDAY: { opensAt: at(9), closesAt: at(17) } })),
    });
    await authedRequest(owner, `/admin/restaurants/${restaurant.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
    });

    expect((await app.request(`/restaurants/${restaurant.slug}`)).status).toBe(404);
  });

  test("the public menu endpoint is unaffected", async () => {
    const { restaurant } = await ownerWithRestaurant();

    const response = await app.request(`/restaurants/${restaurant.slug}/menu`);
    const body = (await response.json()) as { data: { categories: unknown[] } };

    expect(response.status).toBe(200);
    expect(body.data.categories).toEqual([]);
  });
});
