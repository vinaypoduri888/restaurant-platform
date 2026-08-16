import { z } from "zod";
import {
  createRestaurantSchema,
  listRestaurantsQuerySchema,
  updateRestaurantSchema,
} from "@repo/validation/restaurant";

/**
 * The OpenAPI document is generated from the very same Zod schemas the API
 * validates with, using Zod 4's native JSON Schema conversion. Documented
 * constraints therefore cannot drift from enforced constraints — if a rule
 * changes in `@repo/validation`, this document changes with it.
 */
function toSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { io: "input", target: "draft-7" }) as Record<
    string,
    unknown
  >;
  // OpenAPI supplies its own dialect; the embedded $schema key is noise here.
  delete jsonSchema.$schema;
  return jsonSchema;
}

const restaurantSchema = {
  type: "object",
  properties: {
    id: { type: "string", example: "cms45svqa0000psfkfnwah2yl" },
    name: { type: "string", example: "Pizza Palace" },
    slug: { type: "string", example: "pizza-palace" },
    description: { type: "string", nullable: true },
    email: { type: "string", format: "email", nullable: true },
    phone: { type: "string", nullable: true },
    address: { type: "string", nullable: true },
    city: { type: "string", nullable: true },
    country: { type: "string", nullable: true },
    isActive: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: ["id", "name", "slug", "isActive", "createdAt", "updatedAt"],
} as const;

/** The reduced projection returned by the public endpoints. */
const publicRestaurantSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string", example: "Pizza Palace" },
    slug: { type: "string", example: "pizza-palace" },
    description: { type: "string", nullable: true },
    address: { type: "string", nullable: true },
    city: { type: "string", nullable: true },
    country: { type: "string", nullable: true },
  },
  required: ["id", "name", "slug"],
} as const;

const errorResponseSchema = {
  type: "object",
  properties: {
    success: { type: "boolean", enum: [false] },
    error: {
      type: "object",
      properties: {
        message: { type: "string" },
        requestId: { type: "string" },
        issues: { type: "array", items: { type: "object" } },
      },
      required: ["message"],
    },
  },
  required: ["success", "error"],
} as const;

function errorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
  };
}

function successResponse(description: string, dataSchema: unknown) {
  return {
    description,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: { success: { type: "boolean", enum: [true] }, data: dataSchema },
          required: ["success", "data"],
        },
      },
    },
  };
}

const idPathParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "Restaurant identifier (cuid).",
} as const;

const slugPathParameter = {
  name: "slug",
  in: "path",
  required: true,
  schema: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" },
  description: "URL-safe restaurant slug, e.g. `pizza-palace`.",
} as const;

const listQuerySchema = toSchema(listRestaurantsQuerySchema);
const listQueryProperties = (listQuerySchema.properties ?? {}) as Record<string, unknown>;

export function buildOpenApiDocument() {
  return {
    openapi: "3.0.3",
    info: {
      title: "Restaurant Platform API",
      version: "0.1.0",
      description:
        "Backend API for the Digital Restaurant Experience Platform.\n\n" +
        "All responses use a consistent envelope: `{ success: true, data }` on success and " +
        "`{ success: false, error }` on failure. Every response carries an `X-Request-Id` " +
        "header, echoed in `error.requestId` for correlation with server logs.",
    },
    tags: [
      { name: "Health", description: "Liveness and readiness probes." },
      {
        name: "Auth",
        description:
          "Authentication, served by Better Auth under /api/auth. Sign-in establishes an " +
          "httpOnly session cookie which subsequent admin requests must send.",
      },
      {
        name: "Public",
        description:
          "Unauthenticated customer-facing endpoints. Only active restaurants are visible, " +
          "addressed by slug, with administrative fields omitted.",
      },
      {
        name: "Admin",
        description:
          "Authenticated restaurant management. Every route is scoped to the caller's " +
          "restaurant memberships; accessing another restaurant returns 403.",
      },
    ],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token",
          description: "Session cookie issued by POST /api/auth/sign-in/email.",
        },
      },
      schemas: {
        Restaurant: restaurantSchema,
        PublicRestaurant: publicRestaurantSchema,
        ErrorResponse: errorResponseSchema,
        CreateRestaurantInput: toSchema(createRestaurantSchema),
        UpdateRestaurantInput: toSchema(updateRestaurantSchema),
        SignUpInput: {
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 12 },
            name: { type: "string" },
          },
          required: ["email", "password", "name"],
        },
        SignInInput: {
          type: "object",
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
          required: ["email", "password"],
        },
      },
    },
    paths: {
      "/health": {
        get: {
          tags: ["Health"],
          summary: "Liveness probe",
          description: "Confirms the API process is alive. Checks no dependencies.",
          responses: {
            "200": {
              description: "Process is alive.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { status: { type: "string", enum: ["ok"] } },
                    required: ["status"],
                  },
                },
              },
            },
          },
        },
      },
      "/ready": {
        get: {
          tags: ["Health"],
          summary: "Readiness probe",
          description:
            "Verifies this instance can serve traffic, which currently means PostgreSQL is reachable.",
          responses: {
            "200": {
              description: "Ready to serve traffic.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { type: "string", enum: ["ok"] },
                      checks: {
                        type: "object",
                        properties: { database: { type: "string", enum: ["ok"] } },
                      },
                    },
                    required: ["status"],
                  },
                },
              },
            },
            "503": { description: "A required dependency is unavailable." },
          },
        },
      },
      "/api/auth/sign-up/email": {
        post: {
          tags: ["Auth"],
          summary: "Register a new user",
          description:
            "Creates a user and returns a session cookie. Passwords must be at least 12 " +
            "characters and are hashed by Better Auth — never stored in plain text.",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/SignUpInput" } },
            },
          },
          responses: {
            "200": { description: "User created; session cookie set." },
            "400": errorResponse("Invalid registration details."),
            "429": errorResponse("Too many attempts."),
          },
        },
      },
      "/api/auth/sign-in/email": {
        post: {
          tags: ["Auth"],
          summary: "Sign in",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/SignInInput" } },
            },
          },
          responses: {
            "200": { description: "Signed in; session cookie set." },
            "400": errorResponse("Missing or malformed email/password."),
            "401": errorResponse("Invalid credentials."),
            "403": errorResponse("Request origin is not trusted."),
            "429": errorResponse("Too many attempts."),
          },
        },
      },
      "/api/auth/sign-out": {
        post: {
          tags: ["Auth"],
          summary: "Sign out",
          description:
            "Terminates the session server-side when one is present. Deliberately idempotent: " +
            "calling it without a session succeeds rather than failing, so signing out is never " +
            "an error. It is therefore not marked as requiring authentication.",
          responses: {
            "200": { description: "Session terminated, or no session was present." },
            "403": errorResponse("Request origin is not trusted."),
          },
        },
      },
      "/restaurants": {
        get: {
          tags: ["Public"],
          summary: "List active restaurants (public)",
          description:
            "No authentication. Returns only active restaurants with a reduced field set — " +
            "contact details and internal flags are not exposed.",
          parameters: Object.entries(listQueryProperties)
            .filter(([name]) => name !== "isActive")
            .map(([name, schema]) => ({ name, in: "query", required: false, schema })),
          responses: {
            "200": successResponse("Paginated list of active restaurants.", {
              type: "object",
              properties: {
                items: { type: "array", items: { $ref: "#/components/schemas/PublicRestaurant" } },
                total: { type: "integer" },
                page: { type: "integer" },
                limit: { type: "integer" },
              },
              required: ["items", "total", "page", "limit"],
            }),
            "400": errorResponse("Invalid query parameters."),
          },
        },
      },
      "/restaurants/{slug}": {
        get: {
          tags: ["Public"],
          summary: "Get an active restaurant by slug (public)",
          description: "Addressed by slug so internal identifiers are never exposed publicly.",
          parameters: [slugPathParameter],
          responses: {
            "200": successResponse("The requested restaurant.", {
              $ref: "#/components/schemas/PublicRestaurant",
            }),
            "404": errorResponse("No active restaurant with this slug."),
          },
        },
      },
      "/admin/restaurants": {
        get: {
          tags: ["Admin"],
          summary: "List the caller's restaurants",
          description: "Returns only restaurants the authenticated user is a member of.",
          security: [{ sessionCookie: [] }],
          parameters: Object.entries(listQueryProperties).map(([name, schema]) => ({
            name,
            in: "query",
            required: false,
            schema,
          })),
          responses: {
            "200": successResponse("Paginated list of the caller's restaurants.", {
              type: "object",
              properties: {
                items: { type: "array", items: { $ref: "#/components/schemas/Restaurant" } },
                total: { type: "integer" },
                page: { type: "integer" },
                limit: { type: "integer" },
              },
              required: ["items", "total", "page", "limit"],
            }),
            "400": errorResponse("Invalid query parameters."),
            "401": errorResponse("Authentication required."),
          },
        },
        post: {
          tags: ["Admin"],
          summary: "Create a restaurant",
          description:
            "`slug` is optional — when omitted it is generated from `name`. The creating user " +
            "becomes the restaurant's OWNER in the same transaction.",
          security: [{ sessionCookie: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateRestaurantInput" },
              },
            },
          },
          responses: {
            "201": successResponse("Restaurant created.", {
              $ref: "#/components/schemas/Restaurant",
            }),
            "400": errorResponse("Validation failed."),
            "401": errorResponse("Authentication required."),
            "409": errorResponse("A restaurant with this slug already exists."),
          },
        },
      },
      "/admin/restaurants/{id}": {
        get: {
          tags: ["Admin"],
          summary: "Get one of the caller's restaurants",
          security: [{ sessionCookie: [] }],
          parameters: [idPathParameter],
          responses: {
            "200": successResponse("The requested restaurant.", {
              $ref: "#/components/schemas/Restaurant",
            }),
            "401": errorResponse("Authentication required."),
            "403": errorResponse(
              "Not a member of this restaurant. Also returned when the id does not exist, so " +
                "the API does not reveal which identifiers are real.",
            ),
          },
        },
        patch: {
          tags: ["Admin"],
          summary: "Update a restaurant",
          description: "Partial update — only supplied fields change. Requires OWNER or STAFF.",
          security: [{ sessionCookie: [] }],
          parameters: [idPathParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateRestaurantInput" },
              },
            },
          },
          responses: {
            "200": successResponse("Updated restaurant.", {
              $ref: "#/components/schemas/Restaurant",
            }),
            "400": errorResponse("Validation failed."),
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Not permitted to update this restaurant."),
            "409": errorResponse("A restaurant with this slug already exists."),
          },
        },
        delete: {
          tags: ["Admin"],
          summary: "Delete a restaurant",
          description: "Requires the OWNER role.",
          security: [{ sessionCookie: [] }],
          parameters: [idPathParameter],
          responses: {
            "204": { description: "Restaurant deleted." },
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Not permitted to delete this restaurant."),
          },
        },
      },
    },
  };
}
