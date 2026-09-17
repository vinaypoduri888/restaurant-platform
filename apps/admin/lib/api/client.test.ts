import { afterEach, describe, expect, mock, test } from "bun:test";

/**
 * `client.ts` reads the session cookie through `next/headers`, which only
 * exists inside a request. Stubbing it lets the error mapping — the part worth
 * testing — be exercised without a running Next server.
 */
const cookieStore = { getAll: () => [{ name: "better-auth.session_token", value: "token-123" }] };
mock.module("next/headers", () => ({ cookies: async () => cookieStore }));

const {
  apiRequest,
  sessionCookieHeader,
  ApiUnavailableError,
  AuthRequiredError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} = await import("./client");

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockResponse(init: {
  status?: number;
  ok?: boolean;
  jsonBody?: unknown;
  onRequest?: (url: string, options: RequestInit) => void;
}) {
  globalThis.fetch = (async (url: string, options: RequestInit = {}) => {
    init.onRequest?.(url, options);
    const status = init.status ?? 200;

    return {
      ok: init.ok ?? status < 400,
      status,
      headers: new Headers(),
      json: async () => {
        if ("jsonBody" in init) return init.jsonBody;
        throw new Error("no body");
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("sessionCookieHeader", () => {
  test("forwards the session cookie", async () => {
    expect(await sessionCookieHeader()).toBe("better-auth.session_token=token-123");
  });
});

describe("apiRequest", () => {
  test("unwraps the success envelope", async () => {
    mockResponse({ jsonBody: { success: true, data: { id: "r1" } } });

    expect(await apiRequest<{ id: string }>("/admin/restaurants/r1")).toEqual({ id: "r1" });
  });

  test("attaches the session cookie to every request", async () => {
    let sent: RequestInit | undefined;
    mockResponse({
      jsonBody: { success: true, data: [] },
      onRequest: (_url, options) => {
        sent = options;
      },
    });

    await apiRequest("/admin/restaurants");

    expect((sent?.headers as Record<string, string>).Cookie).toBe(
      "better-auth.session_token=token-123",
    );
  });

  /**
   * The opposite of the public site's policy, and deliberately so: an owner who
   * has just changed a price must see that price. A cached copy of their own
   * write reads as data loss.
   */
  test("never caches admin data", async () => {
    let sent: RequestInit | undefined;
    mockResponse({
      jsonBody: { success: true, data: [] },
      onRequest: (_url, options) => {
        sent = options;
      },
    });

    await apiRequest("/admin/restaurants");

    expect(sent?.cache).toBe("no-store");
  });

  test("204 resolves rather than failing on an empty body", async () => {
    mockResponse({ status: 204 });

    expect(await apiRequest("/admin/restaurants/r1", { method: "DELETE" })).toBeUndefined();
  });

  test.each([
    [401, AuthRequiredError],
    [403, ForbiddenError],
    [404, NotFoundError],
    [429, RateLimitError],
    [500, ApiUnavailableError],
    [502, ApiUnavailableError],
  ])("maps %i to the right error type", async (status, expected) => {
    mockResponse({ status, jsonBody: { success: false, error: { message: "x" } } });

    await expect(apiRequest("/admin/restaurants")).rejects.toBeInstanceOf(expected);
  });

  /**
   * 409 messages are written for people and carry the detail that makes them
   * actionable — which slug clashed, how many items block a delete.
   */
  test("surfaces the API's conflict message verbatim", async () => {
    mockResponse({
      status: 409,
      jsonBody: {
        success: false,
        error: { message: 'Category "Starters" still contains 3 menu item(s).' },
      },
    });

    await expect(apiRequest("/admin/x")).rejects.toThrow(/still contains 3 menu item/);
  });

  test("turns validation issues into per-field messages", async () => {
    mockResponse({
      status: 400,
      jsonBody: {
        success: false,
        error: {
          message: "Validation failed",
          issues: [
            { path: ["name"], message: "Name is required" },
            { path: ["priceMinor"], message: "Price must be a whole number" },
          ],
        },
      },
    });

    try {
      await apiRequest("/admin/x", { method: "POST", body: {} });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as InstanceType<typeof ValidationError>).fieldErrors).toEqual({
        name: "Name is required",
        priceMinor: "Price must be a whole number",
      });
    }
  });

  /**
   * A 5xx message is not something to put in front of a user, and could carry
   * internals. It is replaced, not forwarded.
   */
  test("discards server-error messages instead of showing them", async () => {
    mockResponse({
      status: 500,
      jsonBody: {
        success: false,
        error: { message: "connect ECONNREFUSED 10.0.0.4:5432 at /app/src/db.ts" },
      },
    });

    try {
      await apiRequest("/admin/x");
      throw new Error("should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("ECONNREFUSED");
      expect(message).not.toContain("10.0.0.4");
      expect(message).not.toContain("db.ts");
    }
  });

  test("a network failure leaks nothing", async () => {
    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED postgres://user:pw@10.0.0.4:5432");
    }) as unknown as typeof fetch;

    try {
      await apiRequest("/admin/x");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiUnavailableError);
      expect((error as Error).message).not.toContain("postgres");
    }
  });

  test("rejects an unexpected body shape rather than returning undefined", async () => {
    mockResponse({ jsonBody: { unexpected: "shape" } });

    await expect(apiRequest("/admin/x")).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  /**
   * The API answers 403 for both "not a member" and "no such id", so that a
   * signed-in user cannot probe for real ids. Copy that named the resource
   * would undo that on the frontend.
   */
  test("the forbidden message does not confirm the resource exists", async () => {
    mockResponse({ status: 403, jsonBody: { success: false, error: {} } });

    try {
      await apiRequest("/admin/restaurants/some-real-id");
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as Error).message).not.toContain("some-real-id");
    }
  });
});
