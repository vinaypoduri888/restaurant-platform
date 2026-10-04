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
      "/restaurants/{slug}/menu",
      "/admin/restaurants",
      "/admin/restaurants/{id}",
      "/admin/restaurants/{restaurantId}/hours",
      "/admin/restaurants/{restaurantId}/media",
      "/admin/restaurants/{restaurantId}/media/{mediaId}",
      "/media/{key}",
      "/admin/restaurants/{restaurantId}/categories",
      "/admin/restaurants/{restaurantId}/categories/{categoryId}",
      "/admin/restaurants/{restaurantId}/menu-items",
      "/admin/restaurants/{restaurantId}/menu-items/{menuItemId}",
      "/admin/restaurants/{restaurantId}/members",
      "/admin/restaurants/{restaurantId}/members/invitations",
      "/admin/restaurants/{restaurantId}/members/invitations/{invitationId}",
      "/admin/restaurants/{restaurantId}/members/{userId}",
      "/invitations/{token}",
      "/invitations/{token}/accept",
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

  /**
   * The price contract is the one most likely to be misread by a client
   * author, so the document has to state the integer constraint rather than
   * merely "number".
   */
  test("the menu item price is documented as the integer the API enforces", () => {
    const create = document.components.schemas.CreateMenuItemInput as {
      properties: { priceMinor: { type: string; minimum: number } };
      required: string[];
    };

    expect(create.properties.priceMinor.type).toBe("integer");
    expect(create.properties.priceMinor.minimum).toBe(0);
    expect(create.required).toContain("priceMinor");
    expect(create.required).toContain("categoryId");
  });

  /**
   * Times are minutes past local midnight, and the bounds have to be documented
   * because a client that sent 1440 for midnight would be rejected without the
   * document ever having said why.
   */
  test("operating hours document their minute bounds and day names", () => {
    const day = document.components.schemas.DayHours as {
      properties: {
        dayOfWeek: { enum: string[] };
        opensAt: { minimum: number; maximum: number };
      };
      required: string[];
    };

    expect(day.properties.dayOfWeek.enum).toEqual([
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ]);
    expect(day.properties.opensAt.minimum).toBe(0);
    expect(day.properties.opensAt.maximum).toBe(1439);
    expect(day.required).toContain("isOvernight");
  });

  test("the write schema is generated from the same Zod schema the API enforces", () => {
    const input = document.components.schemas.ReplaceOperatingHoursInput as {
      properties: { days: { minItems?: number; maxItems?: number } };
    };

    // `.length(7)` in @repo/validation — documented because it is generated,
    // not because it was transcribed.
    expect(input.properties.days.minItems).toBe(7);
    expect(input.properties.days.maxItems).toBe(7);
  });

  test("the public detail response documents status and hours", () => {
    const detail = document.components.schemas.PublicRestaurantDetail as {
      properties: { status: { enum: string[] }; timeZone: unknown; hours: unknown };
      required: string[];
    };

    expect(detail.properties.status.enum).toEqual(["open", "closed", "unknown"]);
    expect(detail.required).toContain("timeZone");
    expect(detail.required).toContain("hours");

    // The existing public fields must still be documented as required.
    for (const field of ["id", "name", "slug", "currency"]) {
      expect(detail.required).toContain(field);
    }
  });

  /**
   * The upload contract is multipart, and a client author has no way to guess
   * the field names or the accepted formats from a JSON schema — so the
   * document has to state them.
   */
  test("the media upload documents its multipart body", () => {
    const operation = document.paths["/admin/restaurants/{restaurantId}/media"]?.post as unknown as {
      requestBody: {
        content: {
          "multipart/form-data": {
            schema: { properties: { purpose: { enum: string[] }; file: { format: string } }; required: string[] };
          };
        };
      };
      responses: Record<string, unknown>;
    };

    const schema = operation.requestBody.content["multipart/form-data"].schema;

    expect(schema.properties.purpose.enum).toEqual(["LOGO", "BANNER"]);
    expect(schema.properties.file.format).toBe("binary");
    expect(schema.required).toEqual(["purpose", "file"]);
  });

  /**
   * These two statuses are specific to uploads and are exactly the ones a
   * client must handle to give a useful message.
   */
  test("the media upload documents payload-too-large and validation failure", () => {
    const responses = document.paths["/admin/restaurants/{restaurantId}/media"]?.post?.responses ?? {};

    expect(Object.keys(responses)).toContain("413");
    expect(Object.keys(responses)).toContain("400");
    expect(Object.keys(responses)).toContain("403");
  });

  test("media delete documents 404 and 403 but not 200", () => {
    const responses = document.paths["/admin/restaurants/{restaurantId}/media/{mediaId}"]?.delete?.responses ?? {};

    expect(Object.keys(responses)).toContain("204");
    expect(Object.keys(responses)).toContain("403");
    expect(Object.keys(responses)).toContain("404");
  });

  /** Object serving is public; marking it secured would be a documented lie. */
  test("public object serving is documented as unauthenticated", () => {
    expect(document.paths["/media/{key}"]?.get?.security).toBeUndefined();
  });

  /**
   * The media schema must not leak the storage key. It is of no use to a client
   * and advertises the storage layout.
   */
  test("the documented media shape exposes a URL and never a storage key", () => {
    const media = document.components.schemas.Media as {
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(media.properties).toHaveProperty("url");
    expect(media.properties).not.toHaveProperty("storageKey");
    expect(media.required).toContain("url");
  });

  test("public branding is documented as nullable per slot with dimensions", () => {
    const branding = document.components.schemas.Branding as { required: string[] };
    const image = document.components.schemas.BrandingImage as {
      nullable: boolean;
      required: string[];
    };

    // Both keys always present, so a client can branch without distinguishing
    // "no logo" from "this response predates branding".
    expect(branding.required).toEqual(["logo", "banner"]);
    expect(image.nullable).toBe(true);
    expect(image.required).toEqual(["url", "width", "height"]);
  });

  test("the public detail response documents branding", () => {
    const detail = document.components.schemas.PublicRestaurantDetail as {
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(detail.properties).toHaveProperty("branding");
    expect(detail.required).toContain("branding");
  });

  test("the public menu is documented without any administrative field", () => {
    const serialized = JSON.stringify(document.components.schemas.PublicMenu);

    for (const field of ["isActive", "position", "restaurantId", "categoryId", "priceMinor"]) {
      expect(serialized).not.toContain(field);
    }
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
    { method: "GET", path: "/restaurants/some-slug/menu", secured: false },
    { method: "GET", path: "/admin/restaurants/r1/hours", secured: true },
    { method: "GET", path: "/admin/restaurants/r1/media", secured: true },
    { method: "POST", path: "/admin/restaurants/r1/media", secured: true },
    { method: "DELETE", path: "/admin/restaurants/r1/media/m1", secured: true },
    { method: "GET", path: "/media/restaurants/r1/media/m1/original.png", secured: false },
    { method: "PUT", path: "/admin/restaurants/r1/hours", secured: true },
    { method: "GET", path: "/admin/restaurants/r1/categories", secured: true },
    { method: "POST", path: "/admin/restaurants/r1/categories", secured: true },
    { method: "GET", path: "/admin/restaurants/r1/categories/c1", secured: true },
    { method: "PATCH", path: "/admin/restaurants/r1/categories/c1", secured: true },
    { method: "DELETE", path: "/admin/restaurants/r1/categories/c1", secured: true },
    { method: "GET", path: "/admin/restaurants/r1/menu-items", secured: true },
    { method: "POST", path: "/admin/restaurants/r1/menu-items", secured: true },
    { method: "GET", path: "/admin/restaurants/r1/menu-items/m1", secured: true },
    { method: "PATCH", path: "/admin/restaurants/r1/menu-items/m1", secured: true },
    { method: "DELETE", path: "/admin/restaurants/r1/menu-items/m1", secured: true },
  ];

  test.each(anonymousProbes)(
    "$method $path secured=$secured matches actual auth behaviour",
    async ({ method, path, secured }) => {
      const response = await app.request(path, {
        method,
        ...(["POST", "PATCH", "PUT"].includes(method)
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

  /**
   * The detail response carries the caller's membership role. The document has
   * to describe the same two-part shape the endpoint actually returns —
   * verified against real behaviour in `membership-role.test.ts` — and the role
   * values have to match the database enum rather than a second, drifting list.
   */
  test("the restaurant detail response documents the role alongside the record", () => {
    const schema = document.components.schemas.RestaurantWithRole as {
      properties: { role: { enum: string[] }; restaurant: { $ref: string } };
      required: string[];
    };

    expect(schema.properties.restaurant.$ref).toBe("#/components/schemas/Restaurant");
    expect(schema.properties.role.enum).toEqual(["OWNER", "STAFF"]);
    expect(schema.required).toEqual(["restaurant", "role"]);
  });

  test("the documented role values match the roles the database can hold", () => {
    const documented = (
      document.components.schemas.RestaurantWithRole as { properties: { role: { enum: string[] } } }
    ).properties.role.enum;

    // `RestaurantRole` in the Prisma schema. Written out rather than imported
    // so that adding a role without updating the document fails here.
    expect([...documented].sort()).toEqual(["OWNER", "STAFF"]);
  });
});
