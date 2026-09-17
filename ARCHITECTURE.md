# Architecture — Digital Restaurant Experience Platform

This document describes how this system is built and **why** it is built that way. It is written
for a developer joining the project without prior context.

Companion documents:

- `AI_ENGINEER.md` — working conventions, environment setup, and known environment issues.
- `PROJECT_ROADMAP.md` — what is done, what is next, and what is deferred.

## How to read this document

Every section is tagged so that intent is never confused with reality:

| Tag | Meaning |
| --- | --- |
| **IMPLEMENTED** | Exists in the repository today and has been verified working. |
| **PLANNED** | Agreed direction, design decided, **no code written yet**. |
| **FUTURE** | Expected eventually, design deliberately not settled yet. |

If a section is not tagged **IMPLEMENTED**, assume the code does not exist. Do not rely on it.

---

## 1. System overview

**Digital Restaurant Experience Platform** lets a restaurant publish its menu digitally and lets
customers browse it (eventually via a QR code at the table), while restaurant staff manage
content through an admin dashboard.

The architecture is a **modular monolith inside a Turborepo monorepo**.

```
                    ┌───────────────────────┐   ┌───────────────────────┐
                    │  apps/web             │   │  apps/admin           │
                    │  public customer UI   │   │  owner/staff console  │
                    │  Next.js App Router   │   │  Next.js App Router   │
                    └───────────┬───────────┘   └───────────┬───────────┘
                                │              HTTP / JSON  │
                                └─────────────┬─────────────┘
                                              ▼
                                  ┌───────────────────────┐
                                  │  apps/api             │
                                  │  Bun + Hono           │
                                  │  modular monolith     │
                                  │  ┌─────────────────┐  │
                                  │  │ restaurants  ✅ │  │
                                  │  │ auth         ✅ │  │
                                  │  │ categories   ✅ │  │
                                  │  │ menu-items   ✅ │  │
                                  │  │ media        ✅ │  │
                                  │  │ qr           ✅ │  │
                                  │  │ health       ✅ │  │
                                  │  └─────────────────┘  │
                                  └──────┬────────────┬───┘
                                         │            │ Storage interface
                                         │            ▼
                                         │  ┌───────────────────────┐
                                         │  │  local filesystem     │
                                         │  │  — or — Cloudflare R2 │
                                         │  └───────────────────────┘
                                         │ @repo/database
                                         ▼
                              ┌───────────────────────┐
                              │  PostgreSQL (Docker)  │
                              │  Prisma               │
                              └───────────────────────┘

                        ✅ implemented        ⏳ planned, not built
```

**One process, one database, many modules.** There are no microservices, no message brokers, and
no service mesh — deliberately. See §3.2.

---

## 2. Repository layout (IMPLEMENTED)

This is what actually exists on disk today.

```
restaurant-platform/
├── apps/
│   ├── web/          Next.js — public customer experience   (/r/[slug] + menu)
│   ├── admin/        Next.js — restaurant owner/staff console (auth + menu mgmt)
│   ├── api/          Bun + Hono — backend API          (restaurants + menu + media + storage)
│   └── docs/         Next.js — leftover create-turbo sample app; not part of the product
├── packages/
│   ├── database/     Prisma schema, migrations, shared Prisma client (@repo/database)
│   ├── validation/   Shared Zod schemas                              (@repo/validation)
│   ├── ui/           Shared React components                         (@repo/ui)
│   ├── typescript-config/  Shared tsconfig bases                     (@repo/typescript-config)
│   └── eslint-config/      Shared ESLint flat configs                (@repo/eslint-config)
├── docker-compose.yml   Local PostgreSQL 17
├── turbo.json           Task graph (build / lint / check-types / dev)
└── package.json         Bun workspaces
```

Two honest notes about the current state:

- **`apps/docs` is not part of the product.** It is the untouched sample app that came with
  `create-turbo`. It is listed here only so nobody mistakes it for a real application. It should
  eventually be deleted, but removing it is a separate decision (see `PROJECT_ROADMAP.md`).
- **Both frontends are real now.** `apps/web` renders the customer menu at `/r/[slug]`;
  `apps/admin` has sign-in, restaurant selection, and category/menu-item management. What is
  still missing is listed in `PROJECT_ROADMAP.md` rather than here.

---

## 3. Why these choices

### 3.1 Why a monorepo (Turborepo)

The API, the two frontends, and the database schema all describe **the same domain**. A restaurant
is a restaurant whether it is being rendered on a public menu page, edited in the admin console, or
written to Postgres.

In a multi-repo setup, that shared meaning has to travel through published packages and version
bumps. Every schema change becomes a release, a version negotiation, and a window where two repos
disagree about what a `Restaurant` is.

In a monorepo:

- One `bun install`, one `git clone`, one branch, one pull request spans a full feature.
- Types flow directly from Prisma → `@repo/database` → API → (eventually) frontends. A field
  rename surfaces as a **compile error**, not a runtime surprise in production.
- Turborepo caches and parallelises `build` / `lint` / `check-types` across workspaces, so the
  monorepo does not get slower as it grows.

The cost is that the repository is bigger and tooling must be workspace-aware. That is a good
trade for a small team building one coherent product.

### 3.2 Why a modular monolith (not microservices)

This is the single most important decision in the project, so it is worth being explicit.

**A modular monolith means:** one deployable backend process, one database, with strong internal
boundaries between feature modules (`restaurants`, later `auth`, `categories`, `menu-items`).

**Why not microservices:**

- Microservices solve *organisational* scaling — many teams needing to deploy independently. This
  project does not have that problem. Adopting them now would buy distributed-systems costs
  (network failure handling, distributed transactions, eventual consistency, per-service
  deployment and observability) and pay for them with nothing.
- Menu data is highly relational — a restaurant has categories, a category has menu items. In one
  Postgres database that is a foreign key and a join. Split across services it becomes an API call,
  a cache, and a consistency problem.
- Traffic for this product is read-heavy and cacheable, which scales far better by adding replicas
  and a CDN than by decomposing services.

**The modules are the insurance policy.** Because each feature lives behind a clear
routes → controller → service → repository boundary, a module *can* be extracted into its own
service later if a real reason appears. We keep the option without paying for it upfront.

### 3.3 Why PostgreSQL

- The data is genuinely relational: restaurants → categories → menu items, plus users and
  memberships later. Joins and foreign keys are the right tool.
- Real transactions and constraints. A `UNIQUE` constraint on a restaurant slug is enforced by the
  database, not merely hoped for by application code.
- It scales a long way on a single node, and beyond that offers read replicas — which suits a
  read-heavy public menu.
- Mature, portable, and available as a managed service from every serious host, so the local
  Docker container and production can run the same engine.

### 3.4 Why Prisma

- **Type-safe queries.** The generated client types every model and query result, so the API layer
  cannot silently read a field that no longer exists.
- **Migrations are versioned files in git** (`packages/database/prisma/migrations/`), reviewable in
  a pull request, and replayable to rebuild any environment.
- The schema file doubles as living documentation of the data model.

Note: Prisma 7 requires the connection URL in `prisma.config.ts` (it is no longer allowed in
`schema.prisma`), and the runtime client connects through the `@prisma/adapter-pg` driver adapter.
See §7.

### 3.5 Why Bun

- One tool for runtime, package manager, and workspace management, which keeps the toolchain small.
- Fast installs and fast startup, which matters most in the day-to-day edit/restart loop.
- Runs TypeScript directly — no build step for the API in development, and shared packages can be
  imported as raw TypeScript source rather than pre-built bundles (see §6).

### 3.6 Why Hono

- Small and explicit. Routing, middleware, and JSON responses with very little framework ceremony,
  which keeps the modular structure visible rather than hidden behind conventions.
- First-class TypeScript, and a Zod validator integration (`@hono/zod-validator`) that plugs
  directly into the shared validation schemas.
- Runs on Bun today and is portable to other runtimes, so the hosting decision stays open.

### 3.7 Why Next.js (App Router)

- The public menu needs to be **fast and indexable**. Server rendering and static generation give
  real HTML to crawlers and to phones on poor restaurant Wi-Fi.
- The admin console has the opposite profile — interactive, authenticated, not indexed. The App
  Router supports both models in one framework, so the team learns one thing.
- Server Components allow data fetching without shipping that code to the browser.

### 3.8 Why shared packages

Shared packages exist to enforce **one definition of a thing**:

- `@repo/database` — one Prisma client instance and one schema. Prevents every app opening its own
  connection pool and prevents two copies of the data model drifting apart.
- `@repo/validation` — one Zod schema per concept. The API validates a restaurant with the same
  rules an admin form will use to validate it, so client and server cannot disagree about what
  "valid" means.
- `@repo/ui` — shared React components.
- `@repo/typescript-config`, `@repo/eslint-config` — one set of compiler and lint rules, so code
  quality does not depend on which folder you are in.

---

## 4. Applications

### 4.1 `apps/api` — backend (IMPLEMENTED)

Bun + Hono. `index.ts` only opens the socket; the application itself is built in `src/app.ts` so
tests can drive it in-process. Listens on **port 3001**.

Modules: **`restaurants`**, **`auth`**, **`health`**.

**Public — no authentication.** Active restaurants only, reduced field set, addressed by slug.

| Method | Route                     | Behaviour                                         |
| ------ | ------------------------- | ------------------------------------------------- |
| GET    | `/restaurants`            | Paginated list of active restaurants              |
| GET    | `/restaurants/:slug`      | Fetch by slug, with operating hours and an open/closed status; `404` if missing or inactive |
| GET    | `/restaurants/:slug/menu` | Published menu; active categories and items, in order |

**Admin — session required, scoped to the caller's memberships.**

| Method | Route                        | Behaviour                                            |
| ------ | ---------------------------- | ---------------------------------------------------- |
| GET    | `/admin/restaurants`         | Only restaurants the caller is a member of           |
| GET    | `/admin/restaurants/:id`     | `{ restaurant, role }` — the record plus the caller's own role; `403` if not a member |
| POST   | `/admin/restaurants`         | Creator becomes `OWNER` in the same transaction      |
| PATCH  | `/admin/restaurants/:id`     | Partial update; `OWNER` or `STAFF`                   |
| DELETE | `/admin/restaurants/:id`     | `OWNER` only; returns `204`                          |

**Menu — session required, scoped to the caller's memberships.** The restaurant is always in the
path, so the tenant is validated and authorized identically on every route.

| Method | Route | Behaviour |
| ------ | ----- | --------- |
| GET/PUT | `/admin/restaurants/:restaurantId/hours` | Read the week / replace it wholesale |
| GET/POST | `/admin/restaurants/:restaurantId/categories` | List (paginated) / create |
| GET/PATCH/DELETE | `/admin/restaurants/:restaurantId/categories/:categoryId` | `DELETE` is `OWNER` only, and `409` while the category still holds items |
| GET/POST | `/admin/restaurants/:restaurantId/menu-items` | List (paginated, filterable) / create |
| GET/PATCH/DELETE | `/admin/restaurants/:restaurantId/menu-items/:menuItemId` | `DELETE` is `OWNER` only |

**Auth** — `/api/auth/*`, served by Better Auth (sign-up, sign-in, sign-out, session).

**Operational** — `GET /health`, `GET /ready`, `GET /openapi.json`, `GET /docs`.

Cross-cutting infrastructure: typed fail-fast configuration, structured JSON logging with
request-scoped loggers, request IDs, centralised error handling, CORS allow-list, secure headers,
body limits, and rate limiting on authentication endpoints.

### 4.2 `apps/web` — public customer experience (IMPLEMENTED)

The menu customers reach by scanning a code at the table: mobile-first, server-rendered, no
login, no client-side data fetching at all.

| Route | Purpose | Rendering |
| --- | --- | --- |
| `/` | Platform landing page | Static |
| `/r/[slug]` | Restaurant page and menu | Dynamic, ISR-cached fetches (60s, tagged) |

All data crosses one boundary — `lib/api/client.ts` — which owns caching, revalidation tags,
timeouts, and error mapping. `API_BASE_URL` is server-only, so the browser never learns where
the API is and makes no requests to it.

### 4.3 `apps/admin` — restaurant owner/staff console (IMPLEMENTED)

Authenticated management of the restaurant profile, menu sections, and menu items.

| Route | Purpose |
| --- | --- |
| `/login`, `/register` | Authentication |
| `/` | Restaurant picker; redirects straight in when there is exactly one |
| `/restaurants/new` | Create a restaurant |
| `/restaurants/[restaurantId]` | Overview and profile |
| `/restaurants/[restaurantId]/menu` | Categories |
| `/restaurants/[restaurantId]/menu/items` | Menu items |

It deliberately keeps its own ESLint/TypeScript config rather than the shared `@repo/*` ones —
do not "fix" that without discussing it first. It does consume `@repo/ui` and `@repo/validation`.

**Authentication is server-side.** See §5.

---

## 5. How applications communicate

**IMPLEMENTED (mechanism), PLANNED (usage).**

```
apps/web ──┐
           ├── HTTP + JSON ──► apps/api ──► @repo/database ──► PostgreSQL
apps/admin ┘
```

Rules:

1. **The frontends never talk to PostgreSQL directly.** All data access goes through the API. This
   keeps business rules (slug uniqueness, permissions, validation) in exactly one place, and means
   the database is not exposed to anything a browser can reach.
2. **The transport is plain HTTP with JSON.** No GraphQL, no RPC layer, no tRPC.
3. **Types and validation rules are shared through packages, not through the network.** Both sides
   import `@repo/validation`, so a request shape is defined once.

### Authentication transport (IMPLEMENTED)

The admin console's sign-in is performed **by its server, not by the browser**:

```
browser ──form POST──▶ apps/admin Server Action ──▶ POST /api/auth/sign-in/email
                              │                              │
                              │◀──────── Set-Cookie ─────────┘
                              └── re-issues the session on the admin's own origin
```

The alternative — posting credentials from the browser straight to the API — works in
development because cookies ignore ports, but in production `api.example.com` will not send its
cookie to `admin.example.com` unless both are scoped to a shared parent domain. Doing it
server-side removes that deployment constraint entirely, keeps the API URL out of the browser,
and involves no CORS.

Verified before adopting it: the API accepts a server-to-server sign-in with no `Origin` header
(200 + `Set-Cookie`), while a request carrying an untrusted browser `Origin` is still refused
with `403 INVALID_ORIGIN`. Better Auth's CSRF protection is intact; Next's own Server Action
origin check covers the form post.

The session cookie is `httpOnly` on both hops, so no application JavaScript ever reads it.

### Response envelope (IMPLEMENTED)

Every API response uses one consistent shape, so clients never have to guess:

```jsonc
// success
{ "success": true, "data": { /* ... */ } }

// list endpoints
{ "success": true, "data": { "items": [ /* ... */ ], "total": 1, "page": 1, "limit": 20 } }

// failure
{ "success": false, "error": { "message": "Restaurant \"abc\" not found" } }

// validation failure — adds field-level detail
{ "success": false, "error": { "message": "Validation failed", "issues": [ /* Zod issues */ ] } }
```

Status codes: `200` OK, `201` created, `204` deleted, `400` validation, `404` not found,
`409` conflict, `500` unexpected.

---

## 6. Shared packages (IMPLEMENTED)

| Package | Import as | Contains |
| --- | --- | --- |
| `packages/database` | `@repo/database` | Prisma schema, migrations, shared `db` client |
| `packages/validation` | `@repo/validation/<name>` | Zod schemas + inferred TypeScript types |
| `packages/ui` | `@repo/ui/<name>` | Shared React components |
| `packages/typescript-config` | `@repo/typescript-config/<base>` | `base.json`, `nextjs.json`, `react-library.json` |
| `packages/eslint-config` | `@repo/eslint-config/<config>` | `base.js`, `next.js`, `react-internal.js` |

**No build step.** These packages export TypeScript source directly through an `exports` map in
their `package.json` (for example `@repo/validation` maps `"./*"` to `"./src/*.ts"`). Bun and
Next.js compile the source on demand. This removes an entire class of "did you rebuild the
package?" problems during development.

Current honest state of `@repo/ui`: it still holds the three sample components from the starter
(`button`, `card`, `code`) and is only consumed by `apps/web` and `apps/docs`. `apps/admin` does
not use it. Real shared components arrive with the frontend work in Phase 9.

`packages/shared` is referenced in some older notes but **does not exist**. Do not import it.

---

## 7. How database access works (IMPLEMENTED)

**One client, created once, shared everywhere.**

`packages/database/src/client.ts` exports a singleton `db`:

```ts
import { db } from "@repo/database";

const restaurants = await db.restaurant.findMany();
```

Key points:

- The client is constructed with the **`PrismaPg` driver adapter** against `DATABASE_URL`.
- The instance is cached on `globalThis` outside production. Next.js hot-reloads modules on every
  edit; without this cache each reload would open a new connection pool and eventually exhaust
  Postgres connections.
- The generated Prisma client lives at `packages/database/generated/prisma` and is **git-ignored**.
  It is a build artifact — always regenerate with `prisma generate`, never commit it.
- Only the API imports `@repo/database`. Frontends must not (see §5).

**Local database:** PostgreSQL 17 in Docker (`docker-compose.yml`), container
`restaurant-platform-db`, published on **host port 5433**, not the default 5432.

The non-default port is deliberate and must not be "tidied up": this machine runs a separate
native Windows PostgreSQL service on 5432 that silently won connections intended for the
container, which produced a long and expensive debugging session. The full explanation lives in
`AI_ENGINEER.md` under "Local development environment". Read it before changing any port.

### Migrations

Migrations are SQL files under `packages/database/prisma/migrations/`, committed to git. One
exists today: `20260727182447_create_restaurant`.

Before running any Prisma CLI command, read the "Known environment issues" section of
`AI_ENGINEER.md` — this environment has real, reproducible Prisma 7.9.1 CLI defects, and the
documented workarounds are not optional.

### Current data model (IMPLEMENTED)

Table names and column names are snake_case in Postgres and camelCase in TypeScript, mapped via
`@map` / `@@map` — a convention established on the first model that every model since has
followed.

```
Restaurant ──< Category ──< MenuItem
    ├──< OperatingHours    (one row per day of the week)
    ├──< RestaurantMedia   (at most one LOGO and one BANNER)
    └──< RestaurantSlug    (every slug it has ever held, current one included)
```

```prisma
model Restaurant {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  description String?
  email       String?
  phone       String?
  address     String?
  city        String?
  country     String?
  currency    String   @default("USD") @db.VarChar(3)
  timeZone    String   @default("UTC") @map("time_zone")   // IANA identifier
  isActive    Boolean  @default(true) @map("is_active")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@index([isActive])
  @@map("restaurants")
}

model OperatingHours {
  id           String    @id @default(cuid())
  restaurantId String    @map("restaurant_id")
  dayOfWeek    DayOfWeek @map("day_of_week")
  isClosed     Boolean   @default(false) @map("is_closed")
  opensAt      Int?      @map("opens_at")    // minutes past LOCAL midnight, 0-1439
  closesAt     Int?      @map("closes_at")   // < opensAt means the period runs overnight

  @@unique([restaurantId, dayOfWeek])
  @@index([restaurantId])
  @@map("operating_hours")
}

model Category {
  id           String  @id @default(cuid())
  restaurantId String  @map("restaurant_id")
  name         String
  slug         String                            // unique per restaurant, not globally
  description  String?
  position     Int     @default(0)               // curated display order
  isActive     Boolean @default(true) @map("is_active")

  @@unique([restaurantId, slug])
  @@unique([id, restaurantId])                   // target of MenuItem's composite FK
  @@index([restaurantId, isActive, position])
  @@map("categories")
}

model MenuItem {
  id           String  @id @default(cuid())
  restaurantId String  @map("restaurant_id")     // denormalised tenant column
  categoryId   String  @map("category_id")
  name         String
  description  String?
  priceMinor   Int     @map("price_minor")       // integer minor units, never a float
  isAvailable  Boolean @default(true) @map("is_available")   // sold out, still listed
  isActive     Boolean @default(true) @map("is_active")      // published at all
  position     Int     @default(0)

  category Category @relation(fields: [categoryId, restaurantId], references: [id, restaurantId], onDelete: NoAction)

  @@index([categoryId, isActive, position])
  @@index([restaurantId])
  @@map("menu_items")
}

enum MediaPurpose { LOGO  BANNER }

model RestaurantMedia {
  id           String       @id @default(cuid())
  restaurantId String       @map("restaurant_id")
  purpose      MediaPurpose
  storageKey   String       @map("storage_key")    // server-generated; never from a filename
  originalName String       @map("original_name")  // shown back to the owner; never a path
  mimeType     String       @map("mime_type")      // sniffed from magic bytes, not the header
  sizeBytes    Int          @map("size_bytes")
  width        Int                                 // read from the image header, so the
  height       Int                                 // frontend can reserve layout space

  @@unique([restaurantId, purpose])                // one logo, one banner — enforced by Postgres
  @@unique([storageKey])                           // an object belongs to exactly one row
  @@index([restaurantId])
  @@map("restaurant_media")
}

model RestaurantSlug {
  id           String   @id @default(cuid())
  restaurantId String   @map("restaurant_id")
  slug         String   @unique              // globally unique across current AND retired
  createdAt    DateTime @default(now()) @map("created_at")

  @@index([restaurantId])
  @@map("restaurant_slugs")
}
```

Alongside them: `RestaurantMembership` (the `User`↔`Restaurant` join carrying `OWNER`/`STAFF`, see
§11) and the four Better Auth tables (`User`, `Session`, `Account`, `Verification`).

Decisions worth knowing:

- **Money is an integer count of minor units, never a decimal or a float.** `0.1 + 0.2 !== 0.3`
  in binary floating point, and a JSON number *is* a double, so a decimal price cannot survive a
  round trip exactly. The API returns `{ amountMinor, currency, minorUnits }` so a client can
  reconstruct the displayed value without assuming two decimal places — JPY has none, KWD has
  three.
- **Currency lives on `Restaurant`, not on `MenuItem`.** A menu item can never be in a different
  currency from the restaurant serving it; a per-item column could express that contradiction,
  and this cannot.
- **A composite foreign key on `(category_id, restaurant_id)`.** `MenuItem` carries its own
  `restaurantId` so admin queries filter on it directly instead of joining through `Category` —
  but a denormalised tenant column can drift. Referencing `categories(id, restaurant_id)` makes
  cross-tenant assignment impossible in PostgreSQL rather than merely unlikely in application
  code. It is `NO ACTION` rather than `RESTRICT` so that deleting a restaurant still works:
  categories and items are cascade-deleted by that one statement, and `NO ACTION` defers the
  check to the end of it.
- **Deleting a category that still holds items is refused**, at the database and in the service.
  Cascading silently would mean one mis-click destroys a restaurant's whole starters section.
  `?force=true` is the explicit opt-in.
- **An explicit `position`, and it is not unique.** A unique constraint would turn every
  drag-to-reorder into a dance around conflicts; ties are broken by `createdAt` then `id`, so the
  order is always total and repeatable without ever depending on PostgreSQL's physical row order.
- **`isActive` and `isAvailable` are different things.** Unpublished content disappears;
  sold-out content stays on the menu, flagged. A customer who cannot find yesterday's dish
  assumes the menu is broken.
- **Menu items still have no image column.** Restaurant *branding* now exists as its own
  `RestaurantMedia` table (see below), but per-item photos were deliberately left out of Phase 7:
  adding a nullable `imageKey` holding an object-storage key — never a URL (§12) — stays a purely
  additive migration whenever the product needs it.
- **Media is a table, not `logoUrl`/`bannerUrl` columns on `Restaurant`.** A stored URL bakes the
  bucket and CDN hostname into every row, so changing provider becomes a data migration; a key
  plus its metadata keeps the provider a configuration detail and carries the size, MIME type and
  intrinsic dimensions the frontend needs to render without layout shift.
- **A slug belongs to one restaurant forever, and PostgreSQL enforces it.** `restaurant_slugs`
  holds every slug a restaurant has ever held — the current one included — so a single `UNIQUE`
  index covers the whole invariant. Holding only *retired* slugs there would not: a unique index
  cannot span two tables, so nothing would stop restaurant B adopting restaurant A's retired slug
  as its current one, and inheriting every QR code already printed with it. `restaurants.slug`
  stays as the denormalised pointer to the current slug, written in the same transaction — the
  same pattern as `MenuItem.restaurantId`.
- **No `retiredAt` column.** The current slug is exactly the one matching `restaurants.slug`, so a
  retirement flag would be derivable and therefore able to disagree with the column it duplicates.
- **A slug's alphabet is a `CHECK` constraint, not only a Zod schema.** A slug becomes a URL path
  segment, so a value carrying a slash or a `..` is the input that turns into traversal or an open
  redirect. Refusing the shape in the database is stronger than trusting every future write path.
- **`@@unique([restaurantId, purpose])` makes "one logo per restaurant" a database invariant**
  rather than something application code maintains, and avoids a nullable pointer on `Restaurant`
  that could dangle. The cost is that no history is kept — a replacement overwrites, which is
  correct for branding and would not be for anything versioned.
- **Operating hours are minutes past local midnight, not `TIME` columns.** The comparison is not
  a database question: it depends on first converting an instant into the restaurant's own wall
  clock. An integer has no implicit zone attached to it and is trivially comparable.
- **The time zone is an IANA identifier on `Restaurant`, never a fixed offset.** `+05:30` cannot
  express that a zone shifts for daylight saving, so a New York restaurant stored that way would
  be an hour wrong for half the year. Validation rejects offset forms explicitly — `Intl` accepts
  them as time zone values, which was established by probing it rather than assumed.
- **`UTC` is the default zone**, chosen because it is the only value that is never *subtly*
  wrong: it has no daylight saving, so an unset restaurant is off by a constant rather than by an
  amount that changes twice a year. Any plausible real zone would look configured when it is not.
- **An overnight period stays one row.** 22:00→02:00 is stored as `opensAt` 1320, `closesAt` 120,
  not split into two days — splitting would lose the fact that it is one shift. A closed day
  carries `isClosed` and no times at all, so there is exactly one representation of closed.
- **Six hand-written CHECK constraints back the above.** Three on `operating_hours` (minute
  range, the closed/open invariant, and distinct times) and three on `restaurant_media`
  (positive size, positive dimensions, and — most importantly — that `storage_key` starts with
  `restaurants/<restaurant_id>/media/<id>/`, so a row can never point at an object outside its
  own tenant's namespace whatever wrote it). Prisma cannot express CHECK constraints in
  `schema.prisma`, so they are added by hand in the migration; `migrate diff` is run afterwards
  to confirm Prisma still reports no drift, and it does.

- **`cuid()` identifiers, not auto-incrementing integers.** Sequential IDs in public URLs leak how
  many records exist and invite enumeration. `cuid()` also generates without a database round trip.
  The Better Auth tables are the exception — that library generates its own ids.
- **`isActive` instead of deleting rows.** A restaurant can be hidden without destroying data that
  future records (orders, analytics) will reference. It is indexed because "list active
  restaurants" is the common query.
- **A membership join table, not `Restaurant.ownerId`.** A restaurant needs multiple staff, and a
  user may work at several restaurants; a single owner column could express neither.
- **Cascade deletes on every foreign key.** Sessions, accounts, and memberships have no meaning
  without their user, and memberships none without their restaurant. Every foreign key column is
  indexed.
- **snake_case in Postgres, camelCase in TypeScript**, bridged by `@map`/`@@map` — a convention
  set on the first model and followed by every model since.

---

## 8. Backend module anatomy

**IMPLEMENTED for `restaurants`; the template for every future module.**

```
apps/api/
├── index.ts                            opens the socket, nothing else
└── src/
    ├── app.ts                          builds the app (testable without a port)
    ├── config.ts                       the only reader of process.env
    ├── middleware/
    │   ├── auth.ts                     attachSession / requireAuth
    │   ├── request-logger.ts           request-scoped logger + X-Request-Id
    │   └── security.ts                 CORS, secure headers, body limit, rate limit
    ├── modules/
    │   ├── restaurants/
    │   │   ├── restaurant.routes.ts        public + admin routers
    │   │   ├── restaurant.controller.ts    request → service → response
    │   │   ├── restaurant.service.ts       business rules
    │   │   └── restaurant.repository.ts    database access only
    │   ├── auth/
    │   │   ├── auth.config.ts              Better Auth instance
    │   │   └── membership.service.ts       roles → capabilities, authorization
    │   └── health/
    │       ├── health.routes.ts
    │       └── health.service.ts
    ├── openapi/
    │   ├── openapi.document.ts         spec generated from the Zod schemas
    │   └── openapi.routes.ts           /openapi.json and /docs
    ├── shared/
    │   ├── app-env.ts                  typed Hono Variables
    │   ├── errors.ts                   AppError hierarchy (400/401/403/404/409/429)
    │   ├── error-handler.ts            central onError → consistent envelope
    │   ├── http.ts                     ok / created / noContent helpers
    │   ├── logger.ts                   structured JSON logging with redaction
    │   ├── validate.ts                 shared zValidator wrapper
    │   └── validated.ts                typed access to validated request data
    └── test-support/
        └── helpers.ts                  test DB reset (guarded), user/session factories
```

Each layer has exactly one job, and dependencies point in one direction only:

**routes → controller → service → repository → database**

| Layer | Does | Must not |
| --- | --- | --- |
| **routes** | Declare paths and attach Zod validators | Contain business logic |
| **controller** | Read validated input, call the service, shape the response | Query the database, hold business rules |
| **service** | Business rules: slug generation, uniqueness checks, orchestration | Know about HTTP (no status codes, no `Context`) |
| **repository** | Prisma queries | Contain business rules |

Why this matters in practice: the service throws a domain error such as `NotFoundError`, and
`error-handler.ts` is the single place that decides a `NotFoundError` becomes HTTP `404`. Nothing
else in the codebase writes a status code for that case. Error responses cannot drift between
endpoints, and the service stays testable without an HTTP server.

Validation schemas deliberately live **outside** the module, in `@repo/validation`, so the admin
frontend can later validate a form with the exact rules the API enforces.

### How future modules will be organized (PLANNED)

New features become **sibling folders**, never subfolders of an existing module:

```
apps/api/src/modules/
├── restaurants/    ✅ implemented
├── auth/           ✅ implemented
├── categories/     ✅ implemented
├── menu-items/     ✅ implemented
├── media/          ⏳
├── qr/             ⏳
└── analytics/      ⏳
```

Each follows the same four-file structure and mounts itself in `index.ts` with
`app.route("/<resource>", <resource>Routes)`.

Guidance on splitting files: keep a layer as a single flat file until that layer genuinely needs
more than one file (for example a second service covering a distinct concern). Introducing
subfolders earlier adds navigation cost without reducing complexity.

**Cross-module rule:** a module may call another module's **service**, never another module's
repository, and never another module's tables directly. That single rule is what keeps the
boundaries real — and is what would make extracting a module possible later.

---

## 9. Multi-restaurant model

The platform serves many independent restaurants from one deployment.

### Isolation model (IMPLEMENTED)

**Shared database, shared schema, row-level scoping by `restaurantId`.**

Every tenant-owned table carries a `restaurantId` foreign key. A user is linked to a restaurant
through an explicit membership record:

```
User ──< RestaurantMembership >── Restaurant
              (role: OWNER | STAFF)
```

Enforcement happens in the **service layer**, which resolves the caller's permitted restaurant(s)
from their authenticated session and passes that scope down to repositories. Repositories never
run an unscoped query for tenant-owned data.

Why this model rather than a database or schema per restaurant:

- One migration runs once, not once per tenant. Thousands of schemas make every migration a
  batch job and an operational risk.
- One connection pool instead of one per tenant.
- Onboarding a restaurant is an `INSERT`, not a provisioning workflow.

The trade-off is that isolation is enforced by application code, so it must be enforced
**consistently**. Mitigations in place: scoping goes through one place
(`membershipService.authorize`) rather than being hand-written per query, and the test suite
asserts that a non-member receives `403` on read, update, and delete, and that a rejected update
leaves the record unchanged. PostgreSQL Row-Level Security remains available as a database-level
backstop if the product ever needs it, but is not planned for the first release.

One deliberate detail: "you are not a member" and "this id does not exist" both return `403`.
Distinguishing them would let an unauthenticated-but-signed-in caller enumerate valid restaurant
ids.

Public menu pages resolve a restaurant by its **`slug`**, so public URLs never expose internal IDs.

---

## 10. Scaling from one restaurant to thousands

The workload is overwhelmingly **read-heavy**: many customers view menus, few staff edit them.
That shape scales well without architectural change.

**Scaling order — cheapest and least disruptive first:**

1. **Indexes and query discipline.** Index every foreign key and every column used for filtering.
   Watch for N+1 queries. Most early "we need to scale" problems are a missing index.
2. **Cache and CDN the public menu.** Menus change rarely and are identical for every customer of
   a restaurant. Static generation plus CDN caching means most public traffic never reaches the
   API or the database at all. This is by far the highest-leverage step.
3. **Scale the API horizontally.** The API is stateless — no in-memory sessions, no local file
   storage — so more instances behind a load balancer is a configuration change, not a rewrite.
   Uploaded media goes to object storage (§12) specifically to preserve this property.
4. **Add PostgreSQL read replicas.** Route read-only queries to replicas, writes to the primary.
5. **Only then** consider extracting a module into its own service — and only if one module has a
   genuinely different scaling or availability profile from the rest.

Thousands of restaurants is a modest row count for PostgreSQL. The pressure will come from public
menu *reads*, which step 2 absorbs, not from the number of tenants.

---

## 11. Authentication and authorization (IMPLEMENTED)

### Authentication — Better Auth

Authentication is handled by [Better Auth](https://www.better-auth.com), mounted at
`/api/auth/*`, persisting to the same PostgreSQL database through the Prisma adapter.

**Why a library rather than hand-rolled auth:** password hashing, session lifecycle, cookie
flags, and origin checks are security-critical and easy to get subtly wrong in ways that do not
show up in testing. Better Auth is TypeScript-first, framework-agnostic, and has a first-party
Prisma adapter, so it fits the existing stack without displacing anything.

- Email + password, minimum 12 characters. Hashing is Better Auth's (scrypt); plaintext is never
  stored or logged.
- Sessions in `httpOnly`, `SameSite=Lax` cookies (`Secure` in production), not `localStorage`, so
  a cross-site scripting bug cannot exfiltrate them.
- Sessions expire after 7 days, refreshed at most daily.
- Sign-up/sign-in are rate limited to blunt brute-force attempts.
- `trustedOrigins` is bound to the same configured allow-list as CORS.

**Scope boundary:** Better Auth answers *who the caller is* and nothing more. It owns the `User`,
`Session`, `Account`, and `Verification` tables. It does **not** own the domain.

### Authorization — our own membership model

Permission comes from a `RestaurantMembership` row linking a user to a restaurant with a role,
never from a flag on the user:

```
User ──< RestaurantMembership (OWNER | STAFF) >── Restaurant
```

Better Auth ships an `organization` plugin that could have modelled this. It was deliberately not
used: it would rename a core domain concept to "organization" and pull in invitation and team
tables the product does not need yet. Membership is domain vocabulary and stays ours.

**Routes ask for capabilities, not roles.** `membership.service.ts` holds the single mapping from
role to capability:

| Capability | OWNER | STAFF |
| --- | --- | --- |
| `restaurant:read` | ✅ | ✅ |
| `restaurant:update` | ✅ | ✅ |
| `restaurant:delete` | ✅ | ❌ |
| `member:manage` | ✅ | ❌ |
| `menu:read` | ✅ | ✅ |
| `menu:write` | ✅ | ✅ |
| `menu:delete` | ✅ | ❌ |

Adding a role later (`MANAGER`, say) changes that one table rather than every route that would
otherwise have hard-coded `role === "OWNER"`.

**Enforced in middleware plus the service layer.** `requireAuth` middleware establishes identity
and rejects anonymous callers with `401`; the service layer decides what that identity may touch
and throws `403`. Controllers never make authorization decisions, because scattering them is
exactly how inconsistencies appear.

**The caller's role is reported, not inferred.** `GET /admin/restaurants/:id` returns the
membership role alongside the record, so a management UI can hide controls the caller cannot
use rather than offering buttons that always refuse. The value comes from the membership row
`authorize` already read to reach its decision — no extra query, and it cannot be obtained
without passing authorization first. It is informational: every write re-authorizes
independently, so a client that ignored or forged it gains nothing.

**Operating hours follow the restaurant profile policy.** They are governed by
`restaurant:read` / `restaurant:update` — the capabilities that already cover the rest of the
profile — so OWNER and STAFF may both edit them. No capability was invented for this.

**Three access tiers:**

- *Public* — `/restaurants`. No authentication, read-only, active restaurants only, reduced
  fields.
- *Authenticated staff* — `/admin/restaurants`. Every query scoped to the caller's memberships.
- *Platform admin* — not implemented. Deferred until genuinely needed.

---

## 12. Object storage (IMPLEMENTED — local adapter; R2 adapter unverified)

Restaurants will upload logos and menu item photos. Those files must **not** be stored on the API
server's filesystem: it would break horizontal scaling (§10 step 3) and files would vanish when a
container restarts.

**What exists today.** A provider-neutral `Storage` interface in
`apps/api/src/shared/storage/`, with two adapters selected by
`STORAGE_DRIVER=local|r2` — never inferred from `NODE_ENV`. Domain code
depends on the interface and never on `node:fs` or an S3 client, so moving
between them is a configuration change.

- **`local`** writes to `LOCAL_STORAGE_PATH` (default `./storage/uploads`,
  git-ignored, outside any app's `public/`). The API serves those bytes at
  `GET /media/*`. Development only — see §10 step 3 for why this must not be
  production.
- **`r2`** uses **Bun's built-in `S3Client`**, so R2 support costs zero new
  dependencies. It is covered structurally and by unit tests only: there are no
  credentials in this environment, so it has never performed a real upload.
- Keys are `restaurants/{restaurantId}/media/{mediaId}/original.{ext}`,
  generated by the server from ids it controls. A client filename never reaches
  a path, and a database CHECK constraint requires the key to sit under its own
  tenant's prefix.
- Uploads are validated by reading the file's **magic bytes**, not its filename
  or declared `Content-Type`. PNG, JPEG and WebP only; SVG is refused because
  it is XML that can carry script.
- **Consistency:** the database write happens inside a transaction that stays
  open across the storage call, so a storage failure rolls the row back. The
  one window that cannot be closed is a commit failure after the storage call
  succeeded — logged, and unavoidable without a two-phase commit neither system
  offers.
- Deleting a restaurant collects its media keys before the cascade removes the
  rows, then purges the objects afterwards. A foreign key cannot reach object
  storage.

**Also already true, and worth stating so it is not "fixed" later:** the database stores keys and
metadata and never file bytes; uploads are validated for type, size and dimensions; and R2 was
chosen mainly because it has no egress fees, which matters because menu images are read constantly
by customers and egress would otherwise dominate the bill.

**Still intended, not built:**

- **A real upload against a live R2 bucket.** The adapter has never run outside unit tests. This
  is the single largest unverified claim in the system — treat `STORAGE_DRIVER=r2` as untested
  until someone runs it with credentials.
- **Direct-to-storage uploads via presigned URLs.** The browser would request a short-lived signed
  URL from the API, then upload straight to R2, so large bodies never pass through the API
  process. Deferred deliberately: presigned URLs cannot work for a local filesystem, so shipping
  them first would have left development with no working upload path at all. Bytes currently pass
  through the API, capped by `MEDIA_MAX_BYTES` (default 5 MB) via a per-path body limit.
- **A CDN in front of the bucket, and confirmation the bucket is not publicly writable.** Reads
  should be served through a CDN domain; writes are already restricted to authorised users by the
  API, but the bucket's own policy has never been configured because no bucket exists.
- **Image resizing and responsive variants.** Deferred: re-encoding needs a real decoder, which is
  a native dependency this project does not otherwise carry and a materially larger attack
  surface than the header reader in use. `next/image` already covers responsive sizing and modern
  formats at render time.
- **Menu item photos.** Phase 7 was scoped to restaurant branding; per-item images are additive.

---

## 13. Security principles

Applies to everything built from here on.

1. **Validate every input at the boundary.** Every request body, path parameter, and query string
   is parsed by a Zod schema before reaching business logic. Unvalidated input never travels
   inward. *(IMPLEMENTED — shared `validate()` helper, used by every route.)*
2. **Never leak internals in error responses.** Unexpected errors return a generic message; the
   detail is logged server-side. *(IMPLEMENTED — see `error-handler.ts`.)*
3. **Let the database enforce invariants too.** Application checks are for good error messages;
   `UNIQUE` and foreign-key constraints are what actually guarantee correctness under concurrency.
   *(IMPLEMENTED — the slug conflict path handles both the proactive check and Prisma's `P2002`.)*
4. **No secrets in the repository.** Configuration comes from environment variables; `.env` files
   are git-ignored. *(IMPLEMENTED.)*
5. **Least privilege by default.** New endpoints are authenticated and scoped unless there is an
   explicit reason to be public. *(IMPLEMENTED — `/admin/*` requires a session and membership;
   the public surface is an explicit, reduced-field opt-out.)*
6. **Parameterised queries only.** Prisma parameterises by default; raw SQL requires interpolated
   parameters, never string concatenation.
7. **Deny by default at the edge.** CORS allow-lists specific origins rather than `*`; request
   bodies are size-capped; standard security headers are set; state-changing auth calls require a
   trusted `Origin` (Better Auth's CSRF protection, verified rejecting cross-origin sign-in with
   `403 INVALID_ORIGIN`); authentication endpoints are rate limited. *(IMPLEMENTED — see
   `src/middleware/security.ts`.)*
8. **Never trust a header to say who the caller is.** Rate-limit identity comes from the real TCP
   peer address. `X-Forwarded-For` is honoured only when the immediate peer is a configured
   trusted proxy (`TRUSTED_PROXY_IPS`), and then only for hops that proxy actually appended —
   the list is walked from the right, discarding trusted hops, so client-forged leading entries
   are never reached. Misconfiguration is fail-safe: too few trusted proxies means clients share
   a bucket, never that the limit can be evaded. *(IMPLEMENTED — `src/middleware/client-identity.ts`.)*
9. **Never log secrets.** Two layers: keys matching password/token/authorization/cookie/secret/
   credential patterns are redacted at any nesting depth, and credentials embedded in string
   *values* — including `Error` messages and stack traces, where a driver typically puts the
   whole DSN — are stripped as well. *(IMPLEMENTED.)*
10. **Do not confirm what an attacker is guessing.** "Not a member" and "does not exist" return
    the same `403`. *(IMPLEMENTED.)*

---

## 14. Scalability principles

1. **Keep the API stateless.** No in-memory sessions, no local file writes, no sticky sessions.
   State belongs in PostgreSQL or object storage. This is what makes horizontal scaling trivial.
2. **Paginate every list endpoint.** No endpoint returns an unbounded collection. *(IMPLEMENTED —
   `GET /restaurants` defaults to 20 and caps at 100.)*
3. **Cache the public, never the private.** Public menu content is highly cacheable; authenticated
   admin responses are not.
4. **Measure before optimising.** Add observability (Phase 3, Phase 10) so scaling decisions follow
   evidence rather than intuition.
5. **Prefer boring scaling.** Indexes, caching, and replicas before architectural change.

---

## 15. Deployment principles

**FUTURE — nothing is deployed today.** Recorded so the choices are deliberate when the time comes.

1. **One backend artifact.** The modular monolith deploys as a single unit, which keeps deployment
   simple and rollback atomic.
2. **Configuration via environment variables**, never baked into the build. The same artifact runs
   in staging and production with different configuration.
3. **Migrations run as an explicit, separate step before the new version serves traffic** — never
   automatically on application boot, where concurrent instances would race.
4. **Forward-compatible migrations.** Prefer additive changes; when removing a column, ship the
   code that stops using it first, then remove it in a later release. This keeps rollback safe.
5. **Staging mirrors production**, including PostgreSQL major version.
6. **A deploy must be verifiable.** Health and readiness endpoints (Phase 3) let a load balancer
   and a human confirm a release is actually serving before traffic shifts.
7. **CI enforces the same checks as local development**: `lint`, `check-types`, and tests must pass
   before merge.

---

## 16. Known gaps (honest summary)

Things a new developer would otherwise discover the hard way:

- **R2 has never been exercised against a live bucket.** No credentials exist in this
  environment, so `STORAGE_DRIVER=r2` is covered by unit tests only. It is the largest
  unverified claim in the system (§12).
- **The local storage adapter must not be used in production.** It writes to the API's own disk,
  which breaks horizontal scaling and loses files on container restart (§10 step 3).
- **Email is not wired up.** Email verification is therefore disabled, and there is no password
  reset flow — a forgotten password currently has no self-service recovery path.
- **Rate limiting is in-process.** Counters live in one instance's memory, so with several API
  instances each enforces the limit independently. Must move to a shared store (Redis) before
  horizontal scaling. Tracked in Phase 10. (The *bypass* found in the audit is fixed — client
  identity now comes from the real peer address; see §13 principle 7.)
- **The API itself does no caching.** Every public request hits Postgres. `apps/web` fronts it
  with ISR (`revalidate: 60` plus a `restaurant:{slug}` tag), which is what keeps customer
  traffic off the database today — but there is no on-demand invalidation, so an owner's edit
  takes up to 60 seconds to appear. The remaining work is a webhook from the API and a Route
  Handler calling `revalidateTag`.
- **No composite index for the public listing.** `(is_active, created_at DESC, id DESC)` would
  serve that exact query; deliberately not added while the table is tiny, since a speculative
  index is a cost with no measured benefit.
- **`shadcn/ui` is not installed**, despite being named as the component approach in the original
  plan. Tailwind v4 *is* configured in both frontends, sharing tokens from
  `@repo/ui/styles/theme.css`, and shadcn's conventions are followed (cva variants, `cn`,
  token-driven colours) — but the primitives are written directly in `@repo/ui`. This is a
  deliberate standing decision, not an oversight; revisit only for a genuinely complex primitive
  such as a combobox or dialog.
- **`apps/docs` is dead weight** from the starter template and should eventually be removed.
- **`apps/docs` and `apps/api` both default to port 3001.** Do not run them at the same time.
- **Nothing is pushed.** Phases 1–8 are committed on `main`, but there is no remote configured, so
  every commit exists on one machine. That is a backup problem, not a code one.
- **`prisma generate` has a real, reproducible defect in this environment** and can produce an
  incomplete client without failing. Migrations themselves are fine. Read `AI_ENGINEER.md` before
  running Prisma commands.
