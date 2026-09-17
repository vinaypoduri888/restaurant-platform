import { beforeEach, describe, expect, test } from "bun:test";
import { app } from "../../app.ts";
import { config } from "../../config.ts";
import {
  authedRequest,
  createRestaurantAs,
  createTestUser,
  grantMembership,
  resetDatabase,
  type TestUser,
} from "../../test-support/helpers.ts";
import { publicMenuUrl } from "./qr.service.ts";

/**
 * The QR endpoints.
 *
 * The thing worth testing hardest is not that an image comes back — it is
 * *what the image says*. A QR code that encodes the wrong URL is
 * indistinguishable from a correct one by eye, and is only discovered after it
 * has been printed. So the payload is asserted directly, and the encoder's own
 * round-trip is proved separately in `shared/qr/qr.test.ts`.
 */

let owner: TestUser;

beforeEach(async () => {
  await resetDatabase();
  owner = await createTestUser();
});

interface QrBody {
  data: { targetUrl: string; fileName: string; svg: string };
}

async function fetchQr(user: TestUser, restaurantId: string) {
  const response = await authedRequest(user, `/admin/restaurants/${restaurantId}/qr`);
  return { response, body: (await response.json()) as QrBody };
}

describe("the QR target", () => {
  test("is the restaurant's public menu URL", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });
    const { response, body } = await fetchQr(owner, restaurant.id);

    expect(response.status).toBe(200);
    expect(body.data.targetUrl).toBe(`${config.publicWebBaseUrl}/r/spice-house`);
  });

  /**
   * The list of things a printed, permanent artefact must not carry. Each of
   * these has been a real mistake in some system: an internal id that outlives
   * a migration, an API URL that is not meant to be public, an admin URL that
   * invites a customer to try signing in.
   */
  test("carries no internal identifier, API path or admin path", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });
    const { body } = await fetchQr(owner, restaurant.id);
    const { targetUrl } = body.data;

    expect(targetUrl).not.toContain(restaurant.id);
    expect(targetUrl).not.toContain("/admin");
    expect(targetUrl).not.toContain("/api/");
    expect(targetUrl).not.toContain("localhost:3001");
    expect(targetUrl).not.toMatch(/token|key|secret|session/i);
  });

  test("points at the customer site, not at this API", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });
    const { body } = await fetchQr(owner, restaurant.id);

    // The two origins are genuinely different, and confusing them would send
    // every scan to a JSON document instead of a menu.
    expect(config.publicWebBaseUrl).not.toBe(config.auth.baseUrl);
    expect(body.data.targetUrl.startsWith(config.publicWebBaseUrl)).toBe(true);
    expect(body.data.targetUrl.startsWith(config.auth.baseUrl)).toBe(false);
  });

  test("follows the slug after a rename", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "My Restaurant" });

    await authedRequest(owner, `/admin/restaurants/${restaurant.id}`, {
      method: "PATCH",
      body: JSON.stringify({ slug: "spice-house" }),
    });

    const { body } = await fetchQr(owner, restaurant.id);

    // Generated on demand, so it cannot be stale. A stored image would still
    // show the old URL here.
    expect(body.data.targetUrl).toBe(`${config.publicWebBaseUrl}/r/spice-house`);
  });

  test("the URL it encodes actually resolves", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });
    const { body } = await fetchQr(owner, restaurant.id);

    // Take the path back out of the target and ask the public API for it. This
    // is the end-to-end check that the code points somewhere real.
    const slug = new URL(body.data.targetUrl).pathname.replace("/r/", "");
    const publicResponse = await app.request(`/restaurants/${slug}`);

    expect(publicResponse.status).toBe(200);
  });

  test("publicMenuUrl encodes the slug rather than trusting it", () => {
    // The database constrains the slug alphabet, so this is defence in depth.
    // It must still never emit a path-traversing segment.
    expect(publicMenuUrl("spice-house")).toBe(`${config.publicWebBaseUrl}/r/spice-house`);
    expect(publicMenuUrl("../admin")).not.toContain("../");
  });
});

describe("the QR image", () => {
  test("is an SVG document with no external references or script", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });
    const { body } = await fetchQr(owner, restaurant.id);

    expect(body.data.svg.startsWith("<svg")).toBe(true);
    expect(body.data.svg).not.toMatch(/<script|<image|href=|url\(/i);
  });

  test("suggests a filename built from the slug", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });
    const { body } = await fetchQr(owner, restaurant.id);

    expect(body.data.fileName).toBe("spice-house-menu-qr.svg");
  });

  test("names the restaurant in the image's accessible title", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });
    const { body } = await fetchQr(owner, restaurant.id);

    expect(body.data.svg).toContain("Spice House menu QR code");
  });

  /**
   * A restaurant name is owner-controlled text and goes into the SVG's title.
   * Unescaped, a name containing markup would make the document malformed at
   * best and script-bearing at worst.
   */
  test("escapes a restaurant name containing markup", async () => {
    const restaurant = await createRestaurantAs(owner, {
      name: '</title><script>alert(1)</script>',
    });
    const { body } = await fetchQr(owner, restaurant.id);

    expect(body.data.svg).not.toContain("<script>");
    expect(body.data.svg).toContain("&lt;script&gt;");
  });

  test("is deterministic for the same restaurant", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });

    const first = await fetchQr(owner, restaurant.id);
    const second = await fetchQr(owner, restaurant.id);

    // Byte-identical, which is what makes generating on demand equivalent to
    // storing it — and means no cache has to be invalidated.
    expect(second.body.data.svg).toBe(first.body.data.svg);
  });

  test("differs between restaurants", async () => {
    const a = await createRestaurantAs(owner, { name: "First Place" });
    const b = await createRestaurantAs(owner, { name: "Second Place" });

    const qrA = await fetchQr(owner, a.id);
    const qrB = await fetchQr(owner, b.id);

    expect(qrA.body.data.svg).not.toBe(qrB.body.data.svg);
  });

  test("nothing is stored for it", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });
    await fetchQr(owner, restaurant.id);

    // A QR code is derived, not uploaded. It must not appear as media.
    const media = await authedRequest(owner, `/admin/restaurants/${restaurant.id}/media`);
    const body = (await media.json()) as { data: { items: unknown[] } };

    expect(body.data.items).toHaveLength(0);
  });
});

describe("the download", () => {
  test("is served as an SVG attachment", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });

    const response = await authedRequest(
      owner,
      `/admin/restaurants/${restaurant.id}/qr/download`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="spice-house-menu-qr.svg"',
    );
  });

  test("is never cached, because the slug can change at any time", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });

    const response = await authedRequest(
      owner,
      `/admin/restaurants/${restaurant.id}/qr/download`,
    );

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("delivers the same bytes as the preview", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });

    const { body } = await fetchQr(owner, restaurant.id);
    const download = await authedRequest(
      owner,
      `/admin/restaurants/${restaurant.id}/qr/download`,
    );

    expect(await download.text()).toBe(body.data.svg);
  });

  test("the file works with no session — it is self-contained", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });
    const download = await authedRequest(
      owner,
      `/admin/restaurants/${restaurant.id}/qr/download`,
    );
    const svg = await download.text();

    // Nothing in the file needs fetching, so nothing about it depends on the
    // session that downloaded it.
    expect(svg).not.toMatch(/<script|<image|href=|url\(|@import/i);
    expect(svg).toContain("</svg>");
  });
});

describe("authorization", () => {
  test.each([
    ["", "the QR code"],
    ["/download", "the download"],
  ])("an anonymous caller is refused %s with 401", async (suffix) => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });

    const response = await app.request(`/admin/restaurants/${restaurant.id}/qr${suffix}`);

    expect(response.status).toBe(401);
  });

  test.each([
    ["", "the QR code"],
    ["/download", "the download"],
  ])("a non-member is refused %s with 403", async (suffix) => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });
    const stranger = await createTestUser();

    const response = await authedRequest(
      stranger,
      `/admin/restaurants/${restaurant.id}/qr${suffix}`,
    );

    expect(response.status).toBe(403);
  });

  /**
   * `qr:read` is OWNER only. This is a product decision rather than a
   * confidentiality boundary — the payload is a public URL — and it is
   * expressed in the capability table, not as a role check in the QR module.
   */
  test.each([
    ["", "the QR code"],
    ["/download", "the download"],
  ])("a STAFF member is refused %s with 403", async (suffix) => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });
    const staff = await createTestUser();
    await grantMembership(staff, restaurant.id, "STAFF");

    const response = await authedRequest(
      staff,
      `/admin/restaurants/${restaurant.id}/qr${suffix}`,
    );

    expect(response.status).toBe(403);
  });

  test("a staff refusal leaks nothing about the restaurant", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });
    const staff = await createTestUser();
    await grantMembership(staff, restaurant.id, "STAFF");

    const response = await authedRequest(staff, `/admin/restaurants/${restaurant.id}/qr`);
    const text = await response.text();

    expect(text).not.toContain("spice-house");
    expect(text).not.toContain("Spice House");
  });

  test("one restaurant's owner cannot read another's QR code", async () => {
    const mine = await createRestaurantAs(owner, { name: "Mine" });

    const otherOwner = await createTestUser();
    const theirs = await createRestaurantAs(otherOwner, { name: "Theirs" });

    const crossA = await authedRequest(owner, `/admin/restaurants/${theirs.id}/qr`);
    const crossB = await authedRequest(otherOwner, `/admin/restaurants/${mine.id}/qr`);

    expect(crossA.status).toBe(403);
    expect(crossB.status).toBe(403);
  });

  test("a nonexistent restaurant is indistinguishable from one that is not yours", async () => {
    const theirs = await createRestaurantAs(await createTestUser(), { name: "Theirs" });

    const missing = await authedRequest(owner, "/admin/restaurants/does-not-exist/qr");
    const notMine = await authedRequest(owner, `/admin/restaurants/${theirs.id}/qr`);

    expect(missing.status).toBe(403);
    expect(notMine.status).toBe(403);
  });
});

describe("input handling", () => {
  test("a malformed restaurant id is refused, not used to build a URL", async () => {
    for (const id of ["../../etc/passwd", "%2e%2e%2f", " "]) {
      const response = await authedRequest(
        owner,
        `/admin/restaurants/${encodeURIComponent(id)}/qr`,
      );

      // Either rejected by validation or refused by authorization — never a
      // 200, and never a 500.
      expect([400, 403, 404]).toContain(response.status);
    }
  });

  /**
   * The QR target is derived from stored state only. There is deliberately no
   * parameter to influence it, so a query string cannot redirect the code.
   */
  test("query parameters cannot change what the code encodes", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });

    const response = await authedRequest(
      owner,
      `/admin/restaurants/${restaurant.id}/qr?url=https://evil.example.com&targetUrl=https://evil.example.com&slug=evil`,
    );
    const body = (await response.json()) as QrBody;

    expect(response.status).toBe(200);
    expect(body.data.targetUrl).toBe(`${config.publicWebBaseUrl}/r/spice-house`);
    expect(body.data.svg).not.toContain("evil");
  });

  test("a POST to the QR endpoint is not accepted", async () => {
    const restaurant = await createRestaurantAs(owner, { name: "Spice House" });

    const response = await authedRequest(owner, `/admin/restaurants/${restaurant.id}/qr`, {
      method: "POST",
      body: JSON.stringify({ targetUrl: "https://evil.example.com" }),
    });

    // Read-only by construction: there is no QR state to mutate.
    expect(response.status).toBe(404);
  });
});
