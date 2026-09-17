import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@repo/database";
import { app } from "../../app.ts";
import { config } from "../../config.ts";
import { storage } from "../../shared/storage/index.ts";
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

// --- fixtures ---------------------------------------------------------------

/** A real PNG header, so the sniffer sees genuine bytes. */
function pngBytes(width = 64, height = 64, padding = 0): Uint8Array {
  const bytes = new Uint8Array(24 + padding);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function mediaPath(restaurantId: string) {
  return `/admin/restaurants/${restaurantId}/media`;
}

function uploadForm(
  bytes: Uint8Array,
  { purpose = "LOGO", filename = "logo.png", type = "image/png" } = {},
): FormData {
  const form = new FormData();
  form.append("purpose", purpose);
  form.append("file", new File([bytes], filename, { type }));
  return form;
}

async function upload(
  user: TestUser,
  restaurantId: string,
  form: FormData,
): Promise<Response> {
  // No Content-Type header: fetch derives the multipart boundary itself.
  return app.request(mediaPath(restaurantId), {
    method: "POST",
    body: form,
    headers: { Cookie: user.cookie },
  });
}

async function ownerWithRestaurant() {
  const owner = await createTestUser();
  const restaurant = await createRestaurantAs(owner, { name: "Pizza Palace" });
  return { owner, restaurant };
}

interface MediaView {
  id: string;
  purpose: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  originalName: string;
}

// --- tests ------------------------------------------------------------------

describe("authentication", () => {
  test.each([
    ["GET", ""],
    ["POST", ""],
    ["DELETE", "/some-media"],
  ])("%s media%s rejects anonymous callers with 401", async (method, suffix) => {
    const response = await app.request(`${mediaPath("some-restaurant")}${suffix}`, { method });
    expect(response.status).toBe(401);
  });

  test("a forged session cookie is rejected", async () => {
    const response = await app.request(mediaPath("r1"), {
      headers: { Cookie: "better-auth.session_token=forged" },
    });
    expect(response.status).toBe(401);
  });
});

describe("upload", () => {
  test("stores the image and records its metadata", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await upload(owner, restaurant.id, uploadForm(pngBytes(512, 256)));
    const body = (await response.json()) as { data: MediaView };

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      purpose: "LOGO",
      mimeType: "image/png",
      width: 512,
      height: 256,
      originalName: "logo.png",
    });
    expect(body.data.sizeBytes).toBeGreaterThan(0);
  });

  test("the object really exists in storage afterwards", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await upload(owner, restaurant.id, uploadForm(pngBytes()));

    const row = await db.restaurantMedia.findFirst({ where: { restaurantId: restaurant.id } });
    expect(row).not.toBeNull();
    expect(await storage.exists(row!.storageKey)).toBe(true);
  });

  test("the stored bytes are identical to what was uploaded", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const original = pngBytes(64, 64, 32);
    for (let i = 0; i < 32; i += 1) original[24 + i] = i * 8;

    await upload(owner, restaurant.id, uploadForm(original));

    const row = await db.restaurantMedia.findFirst({ where: { restaurantId: restaurant.id } });
    expect(await storage.get(row!.storageKey)).toEqual(original);
  });

  /**
   * The key must be built from server-controlled ids, never from the filename —
   * that is what makes traversal through an upload impossible rather than
   * merely filtered.
   */
  test("the storage key is server-generated and namespaced to the tenant", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await upload(owner, restaurant.id, uploadForm(pngBytes(), { filename: "../../evil.png" }));

    const row = await db.restaurantMedia.findFirst({ where: { restaurantId: restaurant.id } });
    expect(row!.storageKey).toBe(
      `restaurants/${restaurant.id}/media/${row!.id}/original.png`,
    );
    expect(row!.storageKey).not.toContain("..");
    expect(row!.storageKey).not.toContain("evil");
  });

  test("a URL is returned, never a filesystem path", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const response = await upload(owner, restaurant.id, uploadForm(pngBytes()));
    const body = (await response.json()) as { data: MediaView };

    expect(body.data.url).toStartWith("http");
    expect(body.data.url).not.toMatch(/^[A-Za-z]:\\/);
    expect(body.data.url).not.toContain("storage/uploads");
  });

  /** The response must not advertise the storage layout. */
  test("the admin response omits the storage key", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const raw = await (await upload(owner, restaurant.id, uploadForm(pngBytes()))).text();

    expect(raw).not.toContain("storageKey");
  });

  test("uploading a second purpose keeps both", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    await upload(owner, restaurant.id, uploadForm(pngBytes(), { purpose: "LOGO" }));
    await upload(owner, restaurant.id, uploadForm(pngBytes(), { purpose: "BANNER" }));

    expect(await db.restaurantMedia.count({ where: { restaurantId: restaurant.id } })).toBe(2);
  });

  /**
   * `@@unique([restaurantId, purpose])` makes a restaurant have exactly one
   * logo, so a second upload is a deliberate swap — not a second row nothing
   * would choose between.
   */
  test("re-uploading the same purpose replaces the previous one", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const first = (await (await upload(owner, restaurant.id, uploadForm(pngBytes(100, 100)))).json()) as { data: MediaView };
    const second = (await (await upload(owner, restaurant.id, uploadForm(pngBytes(200, 200)))).json()) as { data: MediaView };

    expect(second.data.id).not.toBe(first.data.id);
    expect(await db.restaurantMedia.count({ where: { restaurantId: restaurant.id } })).toBe(1);

    const row = await db.restaurantMedia.findFirst({ where: { restaurantId: restaurant.id } });
    expect(row!.width).toBe(200);
  });

  /** The replaced object must not be left behind wasting storage. */
  test("replacing removes the previous object from storage", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    await upload(owner, restaurant.id, uploadForm(pngBytes(100, 100)));
    const firstRow = await db.restaurantMedia.findFirst({ where: { restaurantId: restaurant.id } });
    const firstKey = firstRow!.storageKey;

    await upload(owner, restaurant.id, uploadForm(pngBytes(200, 200)));

    expect(await storage.exists(firstKey)).toBe(false);
  });
});

describe("upload validation", () => {
  test("rejects a request that is not multipart", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await authedRequest(owner, mediaPath(restaurant.id), {
      method: "POST",
      body: JSON.stringify({ purpose: "LOGO" }),
    });

    expect(response.status).toBe(400);
  });

  test("rejects a missing file field", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const form = new FormData();
    form.append("purpose", "LOGO");

    expect((await upload(owner, restaurant.id, form)).status).toBe(400);
  });

  test.each([
    ["a missing purpose", undefined],
    ["an unknown purpose", "AVATAR"],
    ["a lowercase purpose", "logo"],
    ["an empty purpose", ""],
  ])("rejects %s", async (_label, purpose) => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const form = new FormData();
    if (purpose !== undefined) form.append("purpose", purpose);
    form.append("file", new File([pngBytes()], "logo.png"));

    expect((await upload(owner, restaurant.id, form)).status).toBe(400);
  });

  /**
   * The core of upload security: the client's filename and declared
   * Content-Type are both attacker-chosen, so only the bytes decide.
   */
  test.each([
    ["a PHP script named .png and declared image/png", "<?php system($_GET['c']); ?>"],
    ["an HTML page", "<html><script>alert(1)</script></html>"],
    ["an SVG", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ["plain text", "not an image at all"],
  ])("rejects %s", async (_label, content) => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await upload(
      owner,
      restaurant.id,
      uploadForm(new TextEncoder().encode(content), { filename: "logo.png", type: "image/png" }),
    );

    expect(response.status).toBe(400);
    expect(await db.restaurantMedia.count()).toBe(0);
  });

  test("rejects an empty file", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    expect((await upload(owner, restaurant.id, uploadForm(new Uint8Array()))).status).toBe(400);
  });

  test("rejects an image whose dimensions exceed the configured maximum", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const oversized = config.media.maxDimension + 1;

    const response = await upload(owner, restaurant.id, uploadForm(pngBytes(oversized, 100)));

    expect(response.status).toBe(400);
    expect(await db.restaurantMedia.count()).toBe(0);
  });

  test("rejects a file larger than the configured byte limit", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    // Valid PNG header followed by enough padding to exceed the cap.
    const huge = pngBytes(64, 64, config.media.maxBytes + 1024);

    const response = await upload(owner, restaurant.id, uploadForm(huge));

    expect([400, 413]).toContain(response.status);
    expect(await db.restaurantMedia.count()).toBe(0);
  });

  /**
   * A rejected upload must leave nothing behind — no row, and no object. This
   * is the failure-ordering guarantee, observed rather than reasoned about.
   */
  test("a rejected upload writes nothing to storage", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    await upload(owner, restaurant.id, uploadForm(new TextEncoder().encode("nope")));

    expect(await db.restaurantMedia.count()).toBe(0);
  });

  /** A malicious filename is recorded harmlessly, never used as a path. */
  test.each([
    ["path traversal", "../../../etc/passwd"],
    ["absolute path", "/etc/passwd"],
    ["windows path", "C:\\Windows\\System32\\evil.exe"],
    ["a very long name", `${"a".repeat(400)}.png`],
  ])("accepts an upload with %s in the filename without using it as a path", async (_label, filename) => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await upload(owner, restaurant.id, uploadForm(pngBytes(), { filename }));
    expect(response.status).toBe(201);

    const row = await db.restaurantMedia.findFirst({ where: { restaurantId: restaurant.id } });
    expect(row!.storageKey).toBe(`restaurants/${restaurant.id}/media/${row!.id}/original.png`);
    expect(row!.originalName.length).toBeLessThanOrEqual(255);
    expect(row!.originalName).not.toContain("/");
    expect(row!.originalName).not.toContain("\\");
  });

  /** The restaurant comes from the URL; a body field must not redirect the write. */
  test("a restaurantId in the form cannot redirect the upload", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const victimOwner = await createTestUser();
    const victim = await createRestaurantAs(victimOwner, { name: "Victim Bistro" });

    const form = uploadForm(pngBytes());
    form.append("restaurantId", victim.id);

    expect((await upload(owner, restaurant.id, form)).status).toBe(201);
    expect(await db.restaurantMedia.count({ where: { restaurantId: victim.id } })).toBe(0);
    expect(await db.restaurantMedia.count({ where: { restaurantId: restaurant.id } })).toBe(1);
  });

  test("a client-supplied id is ignored", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const form = uploadForm(pngBytes());
    form.append("id", "attacker-chosen-id");

    const body = (await (await upload(owner, restaurant.id, form)).json()) as { data: MediaView };
    expect(body.data.id).not.toBe("attacker-chosen-id");
  });
});

describe("listing", () => {
  test("returns the restaurant's media with resolved URLs", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await upload(owner, restaurant.id, uploadForm(pngBytes(), { purpose: "LOGO" }));
    await upload(owner, restaurant.id, uploadForm(pngBytes(), { purpose: "BANNER" }));

    const response = await authedRequest(owner, mediaPath(restaurant.id));
    const body = (await response.json()) as { data: { items: MediaView[] } };

    expect(response.status).toBe(200);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items.map((item) => item.purpose).sort()).toEqual(["BANNER", "LOGO"]);
    for (const item of body.data.items) expect(item.url).toStartWith("http");
  });

  test("an empty list is an empty array, not an error", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await authedRequest(owner, mediaPath(restaurant.id));
    const body = (await response.json()) as { data: { items: unknown[] } };

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual([]);
  });
});

describe("delete", () => {
  test("removes the record and the stored object", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await upload(owner, restaurant.id, uploadForm(pngBytes()));
    const row = await db.restaurantMedia.findFirst({ where: { restaurantId: restaurant.id } });

    const response = await authedRequest(owner, `${mediaPath(restaurant.id)}/${row!.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(await db.restaurantMedia.count({ where: { id: row!.id } })).toBe(0);
    expect(await storage.exists(row!.storageKey)).toBe(false);
  });

  test("a nonexistent media id is a 404", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await authedRequest(owner, `${mediaPath(restaurant.id)}/no-such-media`, {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
  });

  /** Deleting the restaurant must take its media rows with it. */
  test("deleting the restaurant cascades to media metadata", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await upload(owner, restaurant.id, uploadForm(pngBytes()));

    await authedRequest(owner, `/admin/restaurants/${restaurant.id}`, { method: "DELETE" });

    expect(await db.restaurantMedia.count({ where: { restaurantId: restaurant.id } })).toBe(0);
  });
});

describe("authorization", () => {
  async function ownerAndStaff() {
    const { owner, restaurant } = await ownerWithRestaurant();
    const staff = await createTestUser();
    await grantMembership(staff, restaurant.id, "STAFF");
    return { owner, staff, restaurant };
  }

  test("STAFF may read and upload — branding is day-to-day work", async () => {
    const { staff, restaurant } = await ownerAndStaff();

    expect((await authedRequest(staff, mediaPath(restaurant.id))).status).toBe(200);
    expect((await upload(staff, restaurant.id, uploadForm(pngBytes()))).status).toBe(201);
  });

  /**
   * Deleting destroys the stored object with no reversible "hide" alternative,
   * which places it with the other irreversible actions — OWNER only, matching
   * `menu:delete` and `restaurant:delete`.
   */
  test("STAFF may NOT delete media", async () => {
    const { owner, staff, restaurant } = await ownerAndStaff();
    await upload(owner, restaurant.id, uploadForm(pngBytes()));
    const row = await db.restaurantMedia.findFirst({ where: { restaurantId: restaurant.id } });

    const response = await authedRequest(staff, `${mediaPath(restaurant.id)}/${row!.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(await db.restaurantMedia.count({ where: { id: row!.id } })).toBe(1);
    // The refused delete must not have removed the object either.
    expect(await storage.exists(row!.storageKey)).toBe(true);
  });

  test("OWNER may delete media", async () => {
    const { owner, restaurant } = await ownerAndStaff();
    await upload(owner, restaurant.id, uploadForm(pngBytes()));
    const row = await db.restaurantMedia.findFirst({ where: { restaurantId: restaurant.id } });

    const response = await authedRequest(owner, `${mediaPath(restaurant.id)}/${row!.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
  });
});

describe("tenant isolation", () => {
  async function twoRestaurants() {
    const { owner: ownerA, restaurant: restaurantA } = await ownerWithRestaurant();
    const ownerB = await createTestUser();
    const restaurantB = await createRestaurantAs(ownerB, { name: "Restaurant B" });
    await upload(ownerB, restaurantB.id, uploadForm(pngBytes()));
    const mediaB = await db.restaurantMedia.findFirst({ where: { restaurantId: restaurantB.id } });
    return { ownerA, restaurantA, ownerB, restaurantB, mediaB: mediaB! };
  }

  test("a non-member cannot list another restaurant's media", async () => {
    const { ownerA, restaurantB } = await twoRestaurants();
    expect((await authedRequest(ownerA, mediaPath(restaurantB.id))).status).toBe(403);
  });

  test("a non-member cannot upload into another restaurant", async () => {
    const { ownerA, restaurantB } = await twoRestaurants();

    const response = await upload(ownerA, restaurantB.id, uploadForm(pngBytes(), { purpose: "BANNER" }));

    expect(response.status).toBe(403);
    expect(await db.restaurantMedia.count({ where: { restaurantId: restaurantB.id } })).toBe(1);
  });

  test("a non-member cannot delete another restaurant's media", async () => {
    const { ownerA, restaurantB, mediaB } = await twoRestaurants();

    const response = await authedRequest(ownerA, `${mediaPath(restaurantB.id)}/${mediaB.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(await db.restaurantMedia.count({ where: { id: mediaB.id } })).toBe(1);
    expect(await storage.exists(mediaB.storageKey)).toBe(true);
  });

  /**
   * The dangerous shape: a real media id from another restaurant, addressed
   * through one the caller *does* own. Authorization passes, so the scoped
   * lookup is the only thing standing between them and someone else's data.
   */
  test("another restaurant's media id is unreachable through one's own", async () => {
    const { ownerA, restaurantA, mediaB } = await twoRestaurants();

    const response = await authedRequest(ownerA, `${mediaPath(restaurantA.id)}/${mediaB.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    expect(await db.restaurantMedia.count({ where: { id: mediaB.id } })).toBe(1);
    expect(await storage.exists(mediaB.storageKey)).toBe(true);
  });

  test("a nonexistent restaurant is answered like a forbidden one", async () => {
    const owner = await createTestUser();
    expect((await authedRequest(owner, mediaPath("cmnonexistentid00000000"))).status).toBe(403);
  });
});

describe("public object serving", () => {
  test("serves the uploaded bytes with the sniffed content type", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const original = pngBytes(64, 64, 16);
    await upload(owner, restaurant.id, uploadForm(original));
    const row = await db.restaurantMedia.findFirst({ where: { restaurantId: restaurant.id } });

    const response = await app.request(`/media/${row!.storageKey}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...original]);
  });

  test("requires no authentication — branding images are public", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await upload(owner, restaurant.id, uploadForm(pngBytes()));
    const row = await db.restaurantMedia.findFirst({ where: { restaurantId: restaurant.id } });

    expect((await app.request(`/media/${row!.storageKey}`)).status).toBe(200);
  });

  test("sends nosniff so bytes are never reinterpreted as something executable", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await upload(owner, restaurant.id, uploadForm(pngBytes()));
    const row = await db.restaurantMedia.findFirst({ where: { restaurantId: restaurant.id } });

    const response = await app.request(`/media/${row!.storageKey}`);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  /** Every one of these would be arbitrary file read if the path were trusted. */
  test.each([
    ["parent traversal", "/media/../../../etc/passwd"],
    ["encoded traversal", "/media/restaurants/%2e%2e/%2e%2e/etc/passwd"],
    ["absolute path", "/media//etc/passwd"],
    ["wrong prefix", "/media/uploads/x/media/y/original.png"],
    ["executable extension", "/media/restaurants/a/media/b/original.php"],
    ["no key", "/media/"],
  ])("refuses %s with 404", async (_label, path) => {
    expect((await app.request(path)).status).toBe(404);
  });

  /**
   * An object is only publicly readable while a row references it, so a key
   * whose record is gone must not still serve bytes.
   */
  test("a key with no database record is not served", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await upload(owner, restaurant.id, uploadForm(pngBytes()));
    const row = await db.restaurantMedia.findFirst({ where: { restaurantId: restaurant.id } });

    // Remove only the metadata, leaving the object behind.
    await db.restaurantMedia.delete({ where: { id: row!.id } });

    expect((await app.request(`/media/${row!.storageKey}`)).status).toBe(404);
  });
});

describe("public restaurant branding", () => {
  test("exposes logo and banner URLs with their dimensions", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await upload(owner, restaurant.id, uploadForm(pngBytes(300, 300), { purpose: "LOGO" }));
    await upload(owner, restaurant.id, uploadForm(pngBytes(1600, 600), { purpose: "BANNER" }));

    const response = await app.request(`/restaurants/${restaurant.slug}`);
    const body = (await response.json()) as {
      data: {
        branding: {
          logo: { url: string; width: number; height: number } | null;
          banner: { url: string; width: number; height: number } | null;
        };
      };
    };

    expect(body.data.branding.logo).toMatchObject({ width: 300, height: 300 });
    expect(body.data.branding.banner).toMatchObject({ width: 1600, height: 600 });
    expect(body.data.branding.logo!.url).toStartWith("http");
  });

  /**
   * `null` rather than an omitted key, so a consumer can branch on it without
   * distinguishing "no logo" from "this response predates branding".
   */
  test("absent media is null, not a missing key", async () => {
    const { restaurant } = await ownerWithRestaurant();

    const response = await app.request(`/restaurants/${restaurant.slug}`);
    const body = (await response.json()) as {
      data: { branding: { logo: unknown; banner: unknown } };
    };

    expect(body.data.branding).toEqual({ logo: null, banner: null });
  });

  test("the public response leaks no storage key, filename, or byte size", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await upload(owner, restaurant.id, uploadForm(pngBytes(), { filename: "owner-secret-file.png" }));

    const raw = await (await app.request(`/restaurants/${restaurant.slug}`)).text();

    expect(raw).not.toContain("storageKey");
    expect(raw).not.toContain("owner-secret-file");
    expect(raw).not.toContain("sizeBytes");
    expect(raw).not.toContain("originalName");
  });

  test("no filesystem path appears in the public response", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await upload(owner, restaurant.id, uploadForm(pngBytes()));

    const raw = await (await app.request(`/restaurants/${restaurant.slug}`)).text();

    expect(raw).not.toContain("storage/uploads");
    expect(raw).not.toMatch(/[A-Za-z]:\\\\/);
  });

  test("existing public fields are unchanged by branding", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await upload(owner, restaurant.id, uploadForm(pngBytes()));

    const body = (await (await app.request(`/restaurants/${restaurant.slug}`)).json()) as {
      data: Record<string, unknown>;
    };

    for (const field of ["id", "name", "slug", "currency", "timeZone", "status", "hours"]) {
      expect(body.data).toHaveProperty(field);
    }
  });

  test("a deactivated restaurant still 404s rather than exposing branding", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await upload(owner, restaurant.id, uploadForm(pngBytes()));
    await authedRequest(owner, `/admin/restaurants/${restaurant.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
    });

    expect((await app.request(`/restaurants/${restaurant.slug}`)).status).toBe(404);
  });

  test("one restaurant's branding never appears in another's response", async () => {
    const { restaurant } = await ownerWithRestaurant();
    const otherOwner = await createTestUser();
    const other = await createRestaurantAs(otherOwner, { name: "Corner Cafe" });
    await upload(otherOwner, other.id, uploadForm(pngBytes()));

    const body = (await (await app.request(`/restaurants/${restaurant.slug}`)).json()) as {
      data: { branding: { logo: unknown } };
    };

    expect(body.data.branding.logo).toBeNull();
  });
});

describe("restaurant deletion cleans up storage", () => {
  /**
   * The database cascade removes media rows, but a foreign key cannot reach
   * object storage. Without an explicit purge every deleted restaurant would
   * leave its images behind forever — which a live check caught, so it is
   * pinned here.
   */
  test("deleting a restaurant removes its objects as well as its rows", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await upload(owner, restaurant.id, uploadForm(pngBytes(), { purpose: "LOGO" }));
    await upload(owner, restaurant.id, uploadForm(pngBytes(), { purpose: "BANNER" }));

    const rows = await db.restaurantMedia.findMany({ where: { restaurantId: restaurant.id } });
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(await storage.exists(row.storageKey)).toBe(true);

    const response = await authedRequest(owner, `/admin/restaurants/${restaurant.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(await db.restaurantMedia.count({ where: { restaurantId: restaurant.id } })).toBe(0);
    for (const row of rows) expect(await storage.exists(row.storageKey)).toBe(false);
  });

  /** One restaurant's deletion must not touch another's objects. */
  test("deleting one restaurant leaves another's objects intact", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await upload(owner, restaurant.id, uploadForm(pngBytes()));

    const otherOwner = await createTestUser();
    const other = await createRestaurantAs(otherOwner, { name: "Corner Cafe" });
    await upload(otherOwner, other.id, uploadForm(pngBytes()));
    const otherRow = await db.restaurantMedia.findFirst({ where: { restaurantId: other.id } });

    await authedRequest(owner, `/admin/restaurants/${restaurant.id}`, { method: "DELETE" });

    expect(await storage.exists(otherRow!.storageKey)).toBe(true);
    expect(await db.restaurantMedia.count({ where: { id: otherRow!.id } })).toBe(1);
  });

  test("a restaurant with no media deletes cleanly", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await authedRequest(owner, `/admin/restaurants/${restaurant.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
  });
});
