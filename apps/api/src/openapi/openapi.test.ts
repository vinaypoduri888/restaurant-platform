import { describe, expect, test } from "bun:test";
import { app } from "../app.ts";
import { buildOpenApiDocument } from "./openapi.document.ts";

const document = buildOpenApiDocument() as {
  paths: Record<string, Record<string, { security?: unknown[]; responses: Record<string, unknown> }>>;
  components: { schemas: Record<string, unknown> };
};

describe("OpenAPI document", () => {
  test("is served and parses", async () => {
    const response = await app.request("/openapi.json");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { openapi: string };
    expect(body.openapi).toBe("3.0.3");
  });

  test("documents every route the app actually exposes", () => {
    const documented = new Set(Object.keys(document.paths));

    for (const path of [
      "/health",
      "/ready",
      "/restaurants",
      "/restaurants/{slug}",
      "/admin/restaurants",
      "/admin/restaurants/{id}",
      "/api/auth/sign-up/email",
      "/api/auth/sign-in/email",
      "/api/auth/sign-out",
    ]) {
      expect(documented).toContain(path);
    }
  });

  test("validation constraints are carried through from the Zod schemas", () => {
    const create = document.components.schemas.CreateRestaurantInput as {
      properties: { name: { maxLength: number }; slug: { pattern: string } };
    };

    // These come from @repo/validation, so documentation cannot drift from
    // what the API actually enforces.
    expect(create.properties.name.maxLength).toBe(255);
    expect(create.properties.slug.pattern).toBe("^[a-z0-9]+(-[a-z0-9]+)*$");
  });
});

/**
 * Conformance: every operation marked `security` must actually reject an
 * anonymous caller, and every operation without it must not. This is what the
 * audit had to check by hand, and it is where the two documented drifts were
 * found.
 */
describe("OpenAPI conformance with real behaviour", () => {
  const anonymousProbes: { method: string; path: string; secured: boolean }[] = [
    { method: "GET", path: "/health", secured: false },
    { method: "GET", path: "/ready", secured: false },
    { method: "GET", path: "/restaurants", secured: false },
    { method: "GET", path: "/admin/restaurants", secured: true },
    { method: "POST", path: "/admin/restaurants", secured: true },
    { method: "GET", path: "/admin/restaurants/some-id", secured: true },
    { method: "PATCH", path: "/admin/restaurants/some-id", secured: true },
    { method: "DELETE", path: "/admin/restaurants/some-id", secured: true },
  ];

  test.each(anonymousProbes)(
    "$method $path secured=$secured matches actual auth behaviour",
    async ({ method, path, secured }) => {
      const response = await app.request(path, {
        method,
        ...(["POST", "PATCH"].includes(method)
          ? { headers: { "Content-Type": "application/json" }, body: "{}" }
          : {}),
      });

      if (secured) {
        expect(response.status).toBe(401);
      } else {
        expect(response.status).not.toBe(401);
      }
    },
  );

  test("sign-out is documented as unauthenticated because it is idempotent", async () => {
    // Audit finding: the document claimed a session was required, but calling
    // it without one succeeds. The behaviour is correct (signing out is never
    // an error), so the document was corrected rather than the endpoint.
    expect(document.paths["/api/auth/sign-out"]?.post?.security).toBeUndefined();

    const response = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: "{}",
    });
    expect(response.status).toBe(200);
  });

  test("sign-in documents the 400 it can actually return", async () => {
    const responses = document.paths["/api/auth/sign-in/email"]?.post?.responses ?? {};
    expect(Object.keys(responses)).toContain("400");

    // A request with no credentials really does produce 400, not 401.
    const response = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: "{}",
    });
    expect(response.status).toBe(400);
  });

  test("admin operations document 401 and 403", () => {
    const get = document.paths["/admin/restaurants/{id}"]?.get?.responses ?? {};
    expect(Object.keys(get)).toContain("401");
    expect(Object.keys(get)).toContain("403");
  });
});
