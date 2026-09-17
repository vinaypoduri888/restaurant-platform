import { afterEach, describe, expect, test } from "bun:test";
import { ApiUnavailableError, ResourceNotFoundError, apiGet } from "./client";
import {
  canonicalPathFor,
  formatLocation,
  restaurantTag,
  type PublicRestaurant,
} from "./restaurants";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(response: Partial<Response> & { jsonBody?: unknown }) {
  globalThis.fetch = (async () =>
    ({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      headers: new Headers(),
      json: async () => {
        if ("jsonBody" in response) return response.jsonBody;
        throw new Error("no body");
      },
    }) as unknown as Response) as unknown as typeof fetch;
}

const restaurant: PublicRestaurant = {
  id: "cms123",
  name: "Pizza Palace",
  slug: "pizza-palace",
  description: "Wood-fired since 1998.",
  address: "12 Market Street",
  city: "Mumbai",
  country: "India",
  currency: "INR",
  timeZone: "Asia/Kolkata",
  status: "open",
  hours: [],
  branding: { logo: null, banner: null },
};

describe("apiGet", () => {
  test("unwraps the success envelope", async () => {
    mockFetch({ jsonBody: { success: true, data: restaurant } });

    const result = await apiGet<PublicRestaurant>("/restaurants/pizza-palace");
    expect(result.name).toBe("Pizza Palace");
  });

  /** A missing restaurant and a deactivated one both arrive as 404. */
  test("maps 404 to ResourceNotFoundError", async () => {
    mockFetch({ ok: false, status: 404, jsonBody: { success: false } });

    await expect(apiGet("/restaurants/nope")).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  test("maps 500 to a generic ApiUnavailableError", async () => {
    mockFetch({ ok: false, status: 500, jsonBody: { success: false } });

    await expect(apiGet("/restaurants/x")).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  test("maps a network failure to ApiUnavailableError", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:3001");
    }) as unknown as typeof fetch;

    await expect(apiGet("/restaurants/x")).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  test("rejects a malformed body rather than returning undefined", async () => {
    mockFetch({ ok: true, status: 200, jsonBody: { unexpected: "shape" } });

    await expect(apiGet("/restaurants/x")).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  /**
   * The customer must never see an internal host, port, or driver message.
   */
  test("error messages carry no internal detail", async () => {
    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED postgres://user:pw@10.0.0.4:5432");
    }) as unknown as typeof fetch;

    try {
      await apiGet("/restaurants/x");
      throw new Error("should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("ECONNREFUSED");
      expect(message).not.toContain("10.0.0.4");
      expect(message).not.toContain("postgres");
    }
  });
});

describe("formatLocation", () => {
  test("joins every part that is present", () => {
    expect(formatLocation(restaurant)).toBe("12 Market Street, Mumbai, India");
  });

  test("skips absent parts without stray punctuation", () => {
    expect(formatLocation({ ...restaurant, address: null, country: null })).toBe("Mumbai");
  });

  test("ignores whitespace-only values", () => {
    expect(
      formatLocation({ ...restaurant, address: "   ", city: "Mumbai", country: null }),
    ).toBe("Mumbai");
  });

  /** Lets the caller omit the whole block instead of rendering an empty line. */
  test("returns null when no location data exists at all", () => {
    expect(formatLocation({ ...restaurant, address: null, city: null, country: null })).toBeNull();
  });
});

describe("restaurantTag", () => {
  test("is per-restaurant so revalidation can target one slug", () => {
    expect(restaurantTag("pizza-palace")).toBe("restaurant:pizza-palace");
    expect(restaurantTag("beta-bistro")).not.toBe(restaurantTag("pizza-palace"));
  });
});

describe("canonicalPathFor", () => {
  /**
   * The rule that keeps printed QR codes working after a rename. The API
   * resolves retired slugs and always reports the current one, so a mismatch
   * means this request arrived on an old URL.
   */
  test("returns nothing when the request is already canonical", () => {
    expect(canonicalPathFor("spice-house", { slug: "spice-house" })).toBeNull();
  });

  test("returns the canonical path when the request used a retired slug", () => {
    expect(canonicalPathFor("my-restaurant", { slug: "spice-house" })).toBe("/r/spice-house");
  });

  /**
   * The loop this guards against: redirecting to the URL already being served
   * would redirect forever. An exact comparison is what prevents it, so it is
   * worth asserting rather than assuming.
   */
  test("never redirects a slug to itself, whatever it looks like", () => {
    for (const slug of ["a", "a-b", "cafe-42", "x".repeat(255)]) {
      expect(canonicalPathFor(slug, { slug })).toBeNull();
    }
  });

  /**
   * Case matters here even though the API lowercases on write: if a retired
   * slug ever differed only by case, sending the visitor to the stored form is
   * correct, and treating them as equal would leave the URL bar wrong.
   */
  test("treats a case difference as a redirect, not a match", () => {
    expect(canonicalPathFor("Spice-House", { slug: "spice-house" })).toBe("/r/spice-house");
  });

  test("builds the path from the CURRENT slug, never the requested one", () => {
    expect(canonicalPathFor("old-name", { slug: "new-name" })).not.toContain("old-name");
  });
});
