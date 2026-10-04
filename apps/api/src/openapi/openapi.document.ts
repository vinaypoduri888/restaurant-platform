import { z } from "zod";
import {
  createCategorySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
} from "@repo/validation/category";
import { inviteMemberSchema, updateMemberRoleSchema } from "@repo/validation/member";
import {
  createMenuItemSchema,
  listMenuItemsQuerySchema,
  updateMenuItemSchema,
} from "@repo/validation/menu-item";
import { replaceOperatingHoursSchema } from "@repo/validation/operating-hours";
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
    currency: { type: "string", example: "USD" },
    timeZone: {
      type: "string",
      example: "Asia/Kolkata",
      description: "IANA identifier the restaurant's operating hours are expressed in.",
    },
    isActive: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: [
    "id",
    "name",
    "slug",
    "currency",
    "timeZone",
    "isActive",
    "createdAt",
    "updatedAt",
  ],
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
    currency: { type: "string", example: "USD" },
  },
  required: ["id", "name", "slug", "currency"],
} as const;

/**
 * One day's operating hours.
 *
 * Times are minutes past **local** midnight in the restaurant's own time zone,
 * not instants: 540 is 09:00 wherever the restaurant stands, in winter and in
 * summer. A closed day carries no times at all.
 */
const dayHoursSchema = {
  type: "object",
  properties: {
    dayOfWeek: {
      type: "string",
      enum: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"],
    },
    isClosed: { type: "boolean" },
    opensAt: {
      type: "integer",
      nullable: true,
      minimum: 0,
      maximum: 1439,
      example: 540,
      description: "Minutes past local midnight. Null when the day is closed.",
    },
    closesAt: { type: "integer", nullable: true, minimum: 0, maximum: 1439, example: 1020 },
    isOvernight: {
      type: "boolean",
      description:
        "True when the period runs past midnight into the next day (closesAt < opensAt), " +
        "e.g. 22:00-02:00. Derived, so clients need not re-implement the rule.",
    },
  },
  required: ["dayOfWeek", "isClosed", "opensAt", "closesAt", "isOvernight"],
} as const;

const operatingHoursSchema = {
  type: "object",
  properties: { days: { type: "array", items: dayHoursSchema } },
  required: ["days"],
} as const;

/** The public detail response: the listing projection plus hours and status. */
const publicRestaurantDetailSchema = {
  type: "object",
  properties: {
    ...publicRestaurantSchema.properties,
    timeZone: { type: "string", example: "Asia/Kolkata" },
    status: {
      type: "string",
      enum: ["open", "closed", "unknown"],
      description:
        "Computed server-side from the restaurant's own time zone and hours at request time. " +
        "`unknown` means no hours have been configured — deliberately not `closed`.",
    },
    hours: {
      type: "array",
      items: dayHoursSchema,
      description: "Empty when no hours have been configured.",
    },
    branding: { $ref: "#/components/schemas/Branding" },
  },
  required: [
    "id",
    "name",
    "slug",
    "currency",
    "timeZone",
    "status",
    "hours",
    "branding",
  ],
} as const;

/**
 * Money crosses the wire as an exact integer plus the information needed to
 * interpret it — never as a decimal, which a JSON double cannot hold exactly.
 */
const moneySchema = {
  type: "object",
  description: "Exact amount in the currency's minor unit. Major units = amountMinor / 10^minorUnits.",
  properties: {
    amountMinor: { type: "integer", example: 1250 },
    currency: { type: "string", example: "USD" },
    minorUnits: { type: "integer", example: 2, description: "0 for JPY, 3 for KWD." },
  },
  required: ["amountMinor", "currency", "minorUnits"],
} as const;

const categorySchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    restaurantId: { type: "string" },
    name: { type: "string", example: "Starters" },
    slug: { type: "string", example: "starters" },
    description: { type: "string", nullable: true },
    position: { type: "integer" },
    isActive: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: ["id", "restaurantId", "name", "slug", "position", "isActive"],
} as const;

const menuItemSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    restaurantId: { type: "string" },
    categoryId: { type: "string" },
    name: { type: "string", example: "Margherita" },
    description: { type: "string", nullable: true },
    priceMinor: { type: "integer", example: 1250 },
    isAvailable: { type: "boolean" },
    isActive: { type: "boolean" },
    position: { type: "integer" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: [
    "id",
    "restaurantId",
    "categoryId",
    "name",
    "priceMinor",
    "isAvailable",
    "isActive",
    "position",
  ],
} as const;

/**
 * The detail response for one restaurant: the record plus the caller's own role
 * in it.
 *
 * The role is derived from the authenticated session's membership row and is
 * informational — it exists so a console can hide controls the caller cannot
 * use. Every write re-authorizes independently.
 */
const restaurantWithRoleSchema = {
  type: "object",
  properties: {
    restaurant: { $ref: "#/components/schemas/Restaurant" },
    role: {
      type: "string",
      enum: ["OWNER", "STAFF"],
      description: "The authenticated caller's membership role in this restaurant.",
    },
  },
  required: ["restaurant", "role"],
} as const;

/** One uploaded branding image, as the admin surface sees it. */
const mediaSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    purpose: { type: "string", enum: ["LOGO", "BANNER"] },
    url: {
      type: "string",
      description:
        "Resolved public URL, built by the API from the configured storage driver. A client " +
        "never learns whether the bytes come from local disk or a CDN, and never sees a " +
        "filesystem path or a storage key.",
    },
    mimeType: {
      type: "string",
      example: "image/png",
      description: "Sniffed from the file's own bytes, not taken from the upload's header.",
    },
    sizeBytes: { type: "integer" },
    width: { type: "integer" },
    height: { type: "integer" },
    originalName: {
      type: "string",
      description:
        "The name the browser sent. Recorded so an owner recognises their file; never used to " +
        "build a path.",
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: ["id", "purpose", "url", "mimeType", "sizeBytes", "width", "height"],
} as const;

const brandingImageSchema = {
  type: "object",
  nullable: true,
  properties: {
    url: { type: "string" },
    width: { type: "integer" },
    height: { type: "integer" },
  },
  required: ["url", "width", "height"],
} as const;

/** The public branding projection: URLs and intrinsic size, nothing internal. */
const brandingSchema = {
  type: "object",
  description:
    "Null for either slot the restaurant has not uploaded — never an omitted key. The " +
    "dimensions let a client reserve layout space and avoid shift.",
  properties: {
    logo: { $ref: "#/components/schemas/BrandingImage" },
    banner: { $ref: "#/components/schemas/BrandingImage" },
  },
  required: ["logo", "banner"],
} as const;

/** The customer-facing menu projection: no internal or administrative fields. */
const publicMenuSchema = {
  type: "object",
  properties: {
    restaurant: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        slug: { type: "string" },
      },
      required: ["id", "name", "slug"],
    },
    categories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          slug: { type: "string" },
          description: { type: "string", nullable: true },
          menuItems: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                description: { type: "string", nullable: true },
                price: moneySchema,
                isAvailable: { type: "boolean" },
              },
              required: ["id", "name", "price", "isAvailable"],
            },
          },
        },
        required: ["id", "name", "slug", "menuItems"],
      },
    },
  },
  required: ["restaurant", "categories"],
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

/** Turns a Zod query schema into OpenAPI query parameters. */
function queryParameters(schema: z.ZodType) {
  const properties = (toSchema(schema).properties ?? {}) as Record<string, unknown>;
  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: "query",
    required: false,
    schema: propertySchema,
  }));
}

const restaurantScopeParameter = {
  name: "restaurantId",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "Restaurant the menu belongs to. The caller must be a member of it.",
} as const;

/** Addresses one member of the restaurant in the path. */
const memberUserParameter = {
  name: "userId",
  in: "path",
  required: true,
  schema: { type: "string" },
  description:
    "The member's user id, as returned by the team list. Scoped by the restaurant in " +
    "the path, so an id from another restaurant matches nothing.",
} as const;

/** The raw invitation token from an emailed link. */
const invitationTokenParameter = {
  name: "token",
  in: "path",
  required: true,
  schema: { type: "string" },
  description:
    "The token from the invitation email. Looked up by its hash - the raw value is " +
    "never stored, so there is nothing to compare against in the database.",
} as const;

const categoryIdParameter = {
  name: "categoryId",
  in: "path",
  required: true,
  schema: { type: "string" },
} as const;

const mediaIdParameter = {
  name: "mediaId",
  in: "path",
  required: true,
  schema: { type: "string" },
} as const;

const menuItemIdParameter = {
  name: "menuItemId",
  in: "path",
  required: true,
  schema: { type: "string" },
} as const;

function paginatedResponse(description: string, itemRef: string) {
  return successResponse(description, {
    type: "object",
    properties: {
      items: { type: "array", items: { $ref: itemRef } },
      total: { type: "integer" },
      page: { type: "integer" },
      limit: { type: "integer" },
    },
    required: ["items", "total", "page", "limit"],
  });
}

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
      {
        name: "Menu",
        description:
          "Authenticated menu management — categories and menu items. Nested under the " +
          "restaurant, so the tenant is always in the path and never taken from a request body. " +
          "OWNER and STAFF may both write; only OWNER may delete.",
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
        TeamMember: {
          type: "object",
          required: ["userId", "role", "createdAt", "user"],
          properties: {
            userId: { type: "string" },
            role: { type: "string", enum: ["OWNER", "STAFF"] },
            createdAt: { type: "string", format: "date-time" },
            user: {
              type: "object",
              required: ["id", "name", "email"],
              description:
                "Only what a roster needs. `emailVerified` and the credential columns " +
                "are deliberately not exposed - that is between a user and the platform, " +
                "not their colleagues.",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                email: { type: "string", format: "email" },
              },
            },
          },
        },
        Invitation: {
          type: "object",
          required: ["id", "email", "role", "expiresAt", "createdAt"],
          description:
            "A pending invitation. The token is absent by construction: the projection " +
            "that builds this cannot select it.",
          properties: {
            id: { type: "string" },
            email: { type: "string", format: "email" },
            role: { type: "string", enum: ["OWNER", "STAFF"] },
            expiresAt: { type: "string", format: "date-time" },
            acceptedAt: { type: ["string", "null"], format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Restaurant: restaurantSchema,
        RestaurantWithRole: restaurantWithRoleSchema,
        PublicRestaurant: publicRestaurantSchema,
        PublicRestaurantDetail: publicRestaurantDetailSchema,
        DayHours: dayHoursSchema,
        Media: mediaSchema,
        Branding: brandingSchema,
        BrandingImage: brandingImageSchema,
        OperatingHours: operatingHoursSchema,
        ReplaceOperatingHoursInput: toSchema(replaceOperatingHoursSchema),
        Category: categorySchema,
        MenuItem: menuItemSchema,
        Money: moneySchema,
        PublicMenu: publicMenuSchema,
        ErrorResponse: errorResponseSchema,
        CreateRestaurantInput: toSchema(createRestaurantSchema),
        UpdateRestaurantInput: toSchema(updateRestaurantSchema),
        CreateCategoryInput: toSchema(createCategorySchema),
        UpdateCategoryInput: toSchema(updateCategorySchema),
        CreateMenuItemInput: toSchema(createMenuItemSchema),
        UpdateMenuItemInput: toSchema(updateMenuItemSchema),
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
          description:
            "Addressed by slug so internal identifiers are never exposed publicly.\n\n" +
            "Accepts any slug the restaurant has **ever** held, not only its current one. A QR " +
            "code is printed and physically deployed, so the URL it carries has to keep working " +
            "after a rename.\n\n" +
            "The response always reports the restaurant's *current* `slug`. A caller that " +
            "requested a retired slug can therefore detect it by comparing, and redirect to the " +
            "canonical URL — which is what `apps/web` does. No extra field marks the " +
            "difference.\n\n" +
            "A retired slug belonging to an inactive restaurant returns `404`, exactly as an " +
            "unknown slug does: a retired slug must not become a way to discover that a " +
            "restaurant was hidden.",
          parameters: [slugPathParameter],
          responses: {
            "200": successResponse("The requested restaurant, with hours and open status.", {
              $ref: "#/components/schemas/PublicRestaurantDetail",
            }),
            "404": errorResponse("No active restaurant with this slug."),
          },
        },
      },
      "/restaurants/{slug}/menu": {
        get: {
          tags: ["Public"],
          summary: "Get a restaurant's published menu (public)",
          description:
            "The whole menu as one document: active categories in display order, each with its " +
            "active items in display order. Deliberately not paginated — a menu is a single " +
            "document to a customer, and per-restaurant write-time caps keep it bounded. " +
            "Sold-out items are returned with `isAvailable: false` rather than omitted. " +
            "Returns 404 for a missing *or* deactivated restaurant, exactly like " +
            "`GET /restaurants/{slug}`.",
          parameters: [slugPathParameter],
          responses: {
            "200": successResponse("The published menu.", {
              $ref: "#/components/schemas/PublicMenu",
            }),
            "404": errorResponse("No active restaurant with this slug."),
          },
        },
      },
      "/admin/restaurants/{restaurantId}/media": {
        get: {
          tags: ["Admin"],
          summary: "List a restaurant's branding media",
          description:
            "Returns each uploaded image with a resolved public URL. The storage key is never " +
            "exposed — it would advertise the storage layout and is of no use to a client.",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter],
          responses: {
            "200": successResponse("The restaurant's media.", {
              type: "object",
              properties: {
                items: { type: "array", items: { $ref: "#/components/schemas/Media" } },
              },
              required: ["items"],
            }),
            "401": errorResponse("Authentication required."),
            "403": errorResponse(
              "Not a member of this restaurant. Also returned when the id does not exist.",
            ),
          },
        },
        post: {
          tags: ["Admin"],
          summary: "Upload a logo or banner",
          description:
            "A `multipart/form-data` upload with two fields: `purpose` (`LOGO` or " +
            "`BANNER`) and `file`.\n\n" +
            "The image format is determined by reading the file's own magic bytes — the " +
            "filename and the declared `Content-Type` are both client-controlled and are not " +
            "trusted. PNG, JPEG and WebP are accepted; SVG is refused because it is XML that " +
            "can carry script.\n\n" +
            "The storage key is generated by the server from the restaurant and media ids, so " +
            "a filename can never influence a path.\n\n" +
            "A restaurant holds at most one image per purpose: uploading again replaces the " +
            "previous one and deletes its stored object. Requires OWNER or STAFF.",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    purpose: { type: "string", enum: ["LOGO", "BANNER"] },
                    file: {
                      type: "string",
                      format: "binary",
                      description: "PNG, JPEG or WebP image.",
                    },
                  },
                  required: ["purpose", "file"],
                },
              },
            },
          },
          responses: {
            "201": successResponse("The stored image.", { $ref: "#/components/schemas/Media" }),
            "400": errorResponse(
              "Not multipart, a missing or unknown `purpose`, a missing `file`, an empty " +
                "file, an unsupported or unrecognised image format, or dimensions beyond the " +
                "configured maximum.",
            ),
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Not permitted to manage this restaurant's media."),
            "413": errorResponse("The upload exceeds the configured maximum size."),
          },
        },
      },
      "/admin/restaurants/{restaurantId}/media/{mediaId}": {
        delete: {
          tags: ["Admin"],
          summary: "Delete a piece of media",
          description:
            "Removes the record and its stored object. Requires the OWNER role: the object is " +
            "destroyed with no reversible alternative, which places it with the other " +
            "irreversible actions.\n\n" +
            "The database row and the storage object are removed inside one transaction that " +
            "spans the storage call, so a storage failure rolls the deletion back rather than " +
            "leaving a record pointing at nothing.",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter, mediaIdParameter],
          responses: {
            "204": { description: "Media deleted." },
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Not permitted to delete this restaurant's media."),
            "404": errorResponse("No such media in this restaurant."),
          },
        },
      },
      "/admin/restaurants/{restaurantId}/members": {
        get: {
          tags: ["Admin"],
          summary: "The restaurant team and pending invitations",
          description:
            "Returns current members with their roles, plus invitations that have been sent " +
            "and not yet accepted.\n\n" +
            "Requires `member:read`, which STAFF also holds: knowing who your colleagues are " +
            "is ordinary workplace information. Every mutation below requires `member:manage`, " +
            "which is OWNER only.\n\n" +
            "Invitation tokens are never returned by any endpoint. They exist only in the " +
            "email that was sent, and the database stores only their SHA-256 hash.",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter],
          responses: {
            "200": successResponse("The team.", {
              type: "object",
              required: ["members", "invitations"],
              properties: {
                members: { type: "array", items: { $ref: "#/components/schemas/TeamMember" } },
                invitations: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Invitation" },
                },
              },
            }),
            "401": errorResponse("Authentication required."),
            "403": errorResponse(
              "Not a member of this restaurant. Also returned when the id does not exist.",
            ),
          },
        },
      },
      "/admin/restaurants/{restaurantId}/members/invitations": {
        post: {
          tags: ["Admin"],
          summary: "Invite someone to join the team",
          description:
            "Emails a single-use invitation link to the address given.\n\n" +
            "**The response never reveals whether that address has an account.** It is " +
            "identical either way, and so is the email - an owner who could learn that for " +
            "any address they typed would be an account-enumeration oracle.\n\n" +
            "Re-inviting the same address replaces the previous invitation rather than " +
            "adding a second one, and invalidates the token that was sent before.\n\n" +
            "Requires the OWNER role.",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: toSchema(inviteMemberSchema) },
            },
          },
          responses: {
            "201": successResponse("The invitation, deliberately without its token.", {
              $ref: "#/components/schemas/Invitation",
            }),
            "400": errorResponse("The address is not a valid email address."),
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Requires the OWNER role."),
            "409": errorResponse("That person is already on the team."),
            "429": errorResponse(
              "Too many invitations have been sent for this restaurant recently.",
            ),
          },
        },
      },
      "/admin/restaurants/{restaurantId}/members/invitations/{invitationId}": {
        delete: {
          tags: ["Admin"],
          summary: "Withdraw a pending invitation",
          description:
            "Deletes the invitation, which immediately stops its emailed link working.\n\n" +
            "Scoped by restaurant in the statement itself, so an invitation id belonging to " +
            "another restaurant matches nothing rather than being deleted.\n\n" +
            "Requires the OWNER role.",
          security: [{ sessionCookie: [] }],
          parameters: [
            restaurantScopeParameter,
            {
              name: "invitationId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "204": { description: "Withdrawn." },
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Requires the OWNER role."),
            "404": errorResponse("No such invitation for this restaurant."),
          },
        },
      },
      "/admin/restaurants/{restaurantId}/members/{userId}": {
        patch: {
          tags: ["Admin"],
          summary: "Change a member role",
          description:
            "Requires the OWNER role, and refuses two cases outright:\n\n" +
            "- **Changing your own role.** Removing the self-service path removes the whole " +
            "privilege-escalation class rather than relying on the capability check.\n" +
            "- **Demoting the last OWNER.** A restaurant with no owner cannot be deleted, " +
            "re-staffed, or have its QR code read, and there is no way back.",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter, memberUserParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: toSchema(updateMemberRoleSchema) },
            },
          },
          responses: {
            "204": { description: "Role changed, or already that role." },
            "400": errorResponse("Unknown role."),
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Requires the OWNER role, or you tried to change your own."),
            "404": errorResponse("That person is not on this team."),
            "409": errorResponse("This is the only owner."),
          },
        },
        delete: {
          tags: ["Admin"],
          summary: "Remove someone from the team",
          description:
            "The removed member loses access immediately.\n\n" +
            "The last OWNER cannot be removed, for the same reason they cannot be demoted.\n\n" +
            "Requires the OWNER role.",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter, memberUserParameter],
          responses: {
            "204": { description: "Removed." },
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Requires the OWNER role."),
            "404": errorResponse("That person is not on this team."),
            "409": errorResponse("This is the only owner."),
          },
        },
      },
      "/invitations/{token}": {
        get: {
          tags: ["Admin"],
          summary: "Describe an invitation",
          description:
            "Lets the acceptance page name the restaurant before anyone commits to joining " +
            "it. Returns only what the invitation email already told the holder.\n\n" +
            "Authenticated: leaving it open would let anyone who found a link learn a " +
            "restaurant name and an invited address without having an account at all.\n\n" +
            "Unknown, expired and already-accepted tokens are all answered identically, so a " +
            "token holder cannot learn whether it was ever valid.",
          security: [{ sessionCookie: [] }],
          parameters: [invitationTokenParameter],
          responses: {
            "200": successResponse("The invitation.", {
              type: "object",
              required: ["email", "role", "restaurantName", "expiresAt"],
              properties: {
                email: { type: "string", format: "email" },
                role: { type: "string", enum: ["OWNER", "STAFF"] },
                restaurantName: { type: "string" },
                expiresAt: { type: "string", format: "date-time" },
              },
            }),
            "401": errorResponse("Authentication required."),
            "404": errorResponse("Not valid, expired, or already used."),
          },
        },
      },
      "/invitations/{token}/accept": {
        post: {
          tags: ["Admin"],
          summary: "Accept an invitation",
          description:
            "Creates the membership the invitation offers.\n\n" +
            "Deliberately **not** scoped by restaurant in the URL: the caller is not a member " +
            "of anything yet, so there is nothing to authorize against. The token carries the " +
            "scope.\n\n" +
            "**The signed-in account must own the invited address.** Without that, an " +
            "invitation would be a transferable membership - anyone a forwarded link reached " +
            "could join.\n\n" +
            "Consumption and membership creation happen in one transaction, and the " +
            "consuming update matches only rows that are still unaccepted, so two " +
            "simultaneous acceptances cannot both succeed.",
          security: [{ sessionCookie: [] }],
          parameters: [invitationTokenParameter],
          responses: {
            "200": successResponse("Joined.", {
              type: "object",
              required: ["restaurantId", "restaurantName", "role"],
              properties: {
                restaurantId: { type: "string" },
                restaurantName: { type: "string" },
                role: { type: "string", enum: ["OWNER", "STAFF"] },
              },
            }),
            "401": errorResponse("Authentication required."),
            "404": errorResponse(
              "Not valid, expired, already used, or addressed to someone else - these are " +
                "deliberately indistinguishable.",
            ),
          },
        },
      },
      "/admin/restaurants/{restaurantId}/qr": {
        get: {
          tags: ["Admin"],
          summary: "The restaurant's menu QR code",
          description:
            "Returns the QR code for this restaurant's public menu, as an SVG document, " +
            "together with the URL it encodes.\n\n" +
            "Nothing is stored. The code is a pure function of the restaurant's current slug " +
            "and the configured public site URL, so the code returned is always the code for " +
            "the current URL — there is no cached image to invalidate after a rename.\n\n" +
            "The encoded URL is assembled from the restaurant's own stored slug and a " +
            "configured origin. No parameter influences it: this endpoint cannot be used to " +
            "mint a QR code pointing anywhere else.\n\n" +
            "Requires the OWNER role. The payload is public information, so this is a product " +
            "decision rather than a confidentiality one — a printed code fixes the " +
            "restaurant's public URL for as long as the code is in service, which is an " +
            "owner's commitment to make.",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter],
          responses: {
            "200": successResponse("The QR code and its target URL.", {
              type: "object",
              required: ["targetUrl", "fileName", "svg"],
              properties: {
                targetUrl: {
                  type: "string",
                  description: "The customer-facing URL the code encodes.",
                  example: "http://localhost:3000/r/spice-house",
                },
                fileName: {
                  type: "string",
                  description: "Suggested filename for a download.",
                  example: "spice-house-menu-qr.svg",
                },
                svg: {
                  type: "string",
                  description:
                    "A self-contained SVG document: no external references, no script, and an " +
                    "opaque light background so it stays scannable when printed or shown on a " +
                    "dark surface.",
                },
              },
            }),
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Not permitted to view this restaurant's QR code."),
          },
        },
      },
      "/admin/restaurants/{restaurantId}/qr/download": {
        get: {
          tags: ["Admin"],
          summary: "Download the menu QR code",
          description:
            "The same code as a file download, with `Content-Disposition: attachment`. " +
            "Served `no-store`: the slug can change at any time, and a cached download would " +
            "hand the owner a file that is not the one they asked for.",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter],
          responses: {
            "200": {
              description: "The QR code as an SVG file.",
              content: { "image/svg+xml": { schema: { type: "string" } } },
            },
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Not permitted to view this restaurant's QR code."),
          },
        },
      },
      "/media/{key}": {
        get: {
          tags: ["Public"],
          summary: "Fetch a stored media object (public)",
          description:
            "Serves uploaded bytes when the `local` storage driver is configured. With the " +
            "`r2` driver the public URL points at Cloudflare and this route is never used.\n\n" +
            "Unauthenticated and read-only — branding images are public. The key must match the " +
            "exact shape the server generates; anything else is a 404, so a traversal attempt " +
            "learns nothing. Responses carry `X-Content-Type-Options: nosniff` and an " +
            "immutable cache policy, since a replacement gets a new key.",
          parameters: [
            {
              name: "key",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Storage key, e.g. `restaurants/<id>/media/<mediaId>/original.png`.",
            },
          ],
          responses: {
            "200": { description: "The image bytes.", content: { "image/*": {} } },
            "404": errorResponse("No such object, or a key this server did not generate."),
          },
        },
      },
      "/admin/restaurants/{restaurantId}/hours": {
        get: {
          tags: ["Admin"],
          summary: "Read a restaurant's operating hours",
          description:
            "Always returns all seven days in reading order, Monday first. Days that have " +
            "never been configured are reported as closed, so an editor can render a row per " +
            "day without inventing the missing ones.",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter],
          responses: {
            "200": successResponse("The full week.", {
              $ref: "#/components/schemas/OperatingHours",
            }),
            "401": errorResponse("Authentication required."),
            "403": errorResponse(
              "Not a member of this restaurant. Also returned when the id does not exist.",
            ),
          },
        },
        put: {
          tags: ["Admin"],
          summary: "Replace a restaurant's operating hours",
          description:
            "Replaces the whole week atomically, so the write is idempotent and no day can be " +
            "left undefined. All seven days must be supplied exactly once. " +
            "Times are minutes past **local** midnight in the restaurant's own time zone " +
            "(0-1439). A closed day must carry no times; an open day must carry both, and they " +
            "must differ. `closesAt < opensAt` is the supported overnight form — 22:00-02:00 " +
            "is stored as 1320-120 and remains one period. " +
            "Requires `restaurant:update`, the same capability that governs the rest of the " +
            "restaurant profile, so OWNER and STAFF may both edit hours.",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ReplaceOperatingHoursInput" },
              },
            },
          },
          responses: {
            "200": successResponse("The stored week.", {
              $ref: "#/components/schemas/OperatingHours",
            }),
            "400": errorResponse(
              "Validation failed: a missing or duplicated day, a minute outside 0-1439, equal " +
                "opening and closing times, or a closed day carrying times.",
            ),
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Not permitted to update this restaurant."),
          },
        },
      },
      "/admin/restaurants/{restaurantId}/categories": {
        get: {
          tags: ["Menu"],
          summary: "List a restaurant's categories",
          description: "Includes inactive categories; that is what the admin surface is for.",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter, ...queryParameters(listCategoriesQuerySchema)],
          responses: {
            "200": paginatedResponse("Paginated categories.", "#/components/schemas/Category"),
            "400": errorResponse("Invalid query parameters."),
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Not a member of this restaurant."),
          },
        },
        post: {
          tags: ["Menu"],
          summary: "Create a category",
          description:
            "`slug` is derived from `name` when omitted, and is unique per restaurant rather " +
            "than globally. `position` defaults to the end of the menu. Requires OWNER or STAFF.",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/CreateCategoryInput" } },
            },
          },
          responses: {
            "201": successResponse("Category created.", { $ref: "#/components/schemas/Category" }),
            "400": errorResponse("Validation failed."),
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Not permitted to manage this restaurant's menu."),
            "409": errorResponse("Slug already used in this restaurant, or the cap was reached."),
          },
        },
      },
      "/admin/restaurants/{restaurantId}/categories/{categoryId}": {
        get: {
          tags: ["Menu"],
          summary: "Get one category",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter, categoryIdParameter],
          responses: {
            "200": successResponse("The category.", { $ref: "#/components/schemas/Category" }),
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Not a member of this restaurant."),
            "404": errorResponse("No such category in this restaurant."),
          },
        },
        patch: {
          tags: ["Menu"],
          summary: "Update a category",
          description: "Partial update. Requires OWNER or STAFF.",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter, categoryIdParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/UpdateCategoryInput" } },
            },
          },
          responses: {
            "200": successResponse("Updated category.", { $ref: "#/components/schemas/Category" }),
            "400": errorResponse("Validation failed."),
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Not permitted to manage this restaurant's menu."),
            "404": errorResponse("No such category in this restaurant."),
            "409": errorResponse("Slug already used in this restaurant."),
          },
        },
        delete: {
          tags: ["Menu"],
          summary: "Delete a category",
          description:
            "Refused with 409 while the category still holds menu items, so a mis-click cannot " +
            "destroy a whole section. Pass `?force=true` to delete the items with it. " +
            "Requires the OWNER role.",
          security: [{ sessionCookie: [] }],
          parameters: [
            restaurantScopeParameter,
            categoryIdParameter,
            {
              name: "force",
              in: "query",
              required: false,
              schema: { type: "string", enum: ["true", "false"] },
              description: "Delete the category's menu items as well.",
            },
          ],
          responses: {
            "204": { description: "Category deleted." },
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Not permitted to delete from this restaurant's menu."),
            "404": errorResponse("No such category in this restaurant."),
            "409": errorResponse("The category still contains menu items."),
          },
        },
      },
      "/admin/restaurants/{restaurantId}/menu-items": {
        get: {
          tags: ["Menu"],
          summary: "List a restaurant's menu items",
          description: "Optionally filtered by category, published state, or availability.",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter, ...queryParameters(listMenuItemsQuerySchema)],
          responses: {
            "200": paginatedResponse("Paginated menu items.", "#/components/schemas/MenuItem"),
            "400": errorResponse("Invalid query parameters."),
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Not a member of this restaurant."),
          },
        },
        post: {
          tags: ["Menu"],
          summary: "Create a menu item",
          description:
            "`priceMinor` is a whole number of minor units (1250 = 12.50); decimals are rejected " +
            "rather than rounded. `categoryId` must belong to the same restaurant. " +
            "Requires OWNER or STAFF.",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/CreateMenuItemInput" } },
            },
          },
          responses: {
            "201": successResponse("Menu item created.", { $ref: "#/components/schemas/MenuItem" }),
            "400": errorResponse("Validation failed."),
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Not permitted to manage this restaurant's menu."),
            "404": errorResponse("No such category in this restaurant."),
            "409": errorResponse("The category has reached its item cap."),
          },
        },
      },
      "/admin/restaurants/{restaurantId}/menu-items/{menuItemId}": {
        get: {
          tags: ["Menu"],
          summary: "Get one menu item",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter, menuItemIdParameter],
          responses: {
            "200": successResponse("The menu item.", { $ref: "#/components/schemas/MenuItem" }),
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Not a member of this restaurant."),
            "404": errorResponse("No such menu item in this restaurant."),
          },
        },
        patch: {
          tags: ["Menu"],
          summary: "Update a menu item",
          description:
            "Partial update. Supplying `categoryId` moves the item to another section of the " +
            "same restaurant's menu. Requires OWNER or STAFF.",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter, menuItemIdParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/UpdateMenuItemInput" } },
            },
          },
          responses: {
            "200": successResponse("Updated menu item.", { $ref: "#/components/schemas/MenuItem" }),
            "400": errorResponse("Validation failed."),
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Not permitted to manage this restaurant's menu."),
            "404": errorResponse("No such menu item or target category in this restaurant."),
          },
        },
        delete: {
          tags: ["Menu"],
          summary: "Delete a menu item",
          description:
            "Requires the OWNER role. Staff take an item off the menu with `isActive` or " +
            "`isAvailable` instead, which is reversible.",
          security: [{ sessionCookie: [] }],
          parameters: [restaurantScopeParameter, menuItemIdParameter],
          responses: {
            "204": { description: "Menu item deleted." },
            "401": errorResponse("Authentication required."),
            "403": errorResponse("Not permitted to delete from this restaurant's menu."),
            "404": errorResponse("No such menu item in this restaurant."),
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
          summary: "Get one of the caller's restaurants, with their role in it",
          description:
            "Returns the restaurant together with the authenticated caller's membership role " +
            "(`OWNER` or `STAFF`), so a management UI can show only the actions that caller " +
            "can perform. The role is read from the membership row that authorized the " +
            "request — it is never taken from the request — and is informational: every write " +
            "endpoint re-authorizes independently.",
          security: [{ sessionCookie: [] }],
          parameters: [idPathParameter],
          responses: {
            "200": successResponse("The requested restaurant and the caller's role.", {
              $ref: "#/components/schemas/RestaurantWithRole",
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
          description:
            "Partial update — only supplied fields change. Requires OWNER or STAFF.\n\n" +
            "**Changing `slug` renames the restaurant's public URL and retires the old one.** " +
            "The previous slug stays reserved to this restaurant permanently and keeps " +
            "resolving, so printed QR codes continue to work; `GET /restaurants/{slug}` " +
            "redirects callers to the new canonical URL. Slug changes are applied in one " +
            "transaction with the reservation, so the two can never disagree.\n\n" +
            "A slug that any restaurant has ever held is refused with `409`, including slugs " +
            "that are retired rather than in use — otherwise a rename could hand one " +
            "restaurant's printed codes to another. A restaurant may freely reclaim a slug it " +
            "held itself, which is a reverted rename.",
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
