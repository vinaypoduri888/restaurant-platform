# Project Roadmap — Digital Restaurant Experience Platform

Where the project actually stands, what comes next, and what is deliberately deferred.

Companion documents:

- `ARCHITECTURE.md` — how the system is designed and why.
- `AI_ENGINEER.md` — working conventions, environment setup, known environment issues.

## Status legend

| Status | Meaning |
| --- | --- |
| **COMPLETED** | Built and verified working in the repository today. |
| **NEXT** | The phase currently being picked up. |
| **PLANNED** | Agreed scope, not started. |
| **FUTURE** | Expected eventually; scope intentionally not settled. |

**Current position: Phases 0–4 complete. The backend phase is finished; Phase 5 is next.**

```
  ✅ 0 ── ✅ 1 ── ✅ 2 ── ✅ 3 ── ✅ 4 ── ▶ 5 ── ○ 6 ── ○ 7 ── ○ 8 ── ○ 9 ── ○ 10
 found.  database  restaurant  backend   auth  restaurant menu  media   QR &   front  production
         foundation backend    infra                mgmt        public  end
```

A phase is only marked COMPLETED when the work exists in the repository — not when it has been
designed or discussed.

---

## PHASE 0 — Foundation

**Status: COMPLETED**

Project skeleton and toolchain.

- [x] Turborepo monorepo with Bun workspaces (`turbo.json`, root `package.json`)
- [x] Bun as runtime and package manager throughout
- [x] Next.js applications scaffolded — `apps/web`, `apps/admin`
- [x] Hono API application — `apps/api`, running on port 3001
- [x] PostgreSQL via Docker — `docker-compose.yml`
- [x] Prisma installed and configured in `packages/database`
- [x] Shared database package — `@repo/database`
- [x] Shared TypeScript config — `@repo/typescript-config`
- [x] Shared ESLint config — `@repo/eslint-config`
- [x] `apps/api` wired into the shared configs with `lint` and `check-types` scripts

Notes carried forward:

- `apps/admin` deliberately uses its own ESLint/TypeScript config instead of the shared `@repo/*`
  packages. This is intentional — do not "fix" it without discussing first.
- `apps/admin` has no `check-types` script, so `turbo run check-types` skips it. Worth closing in
  Phase 9 when real UI code lands there.
- `apps/docs` exists as leftover `create-turbo` sample content. It is not part of the product and
  should eventually be removed.

---

## PHASE 1 — Database Foundation

**Status: COMPLETED**

A real database, a real schema, and a shared client proven against it.

- [x] PostgreSQL 17 running in Docker, container `restaurant-platform-db`
- [x] Dedicated project database `restaurant_platform`
- [x] **Host port 5433** mapped to container port 5432
- [x] Container healthcheck (`pg_isready`) so readiness is externally observable
- [x] Prisma schema — `packages/database/prisma/schema.prisma`
- [x] `Restaurant` model with snake_case column mapping and an index on `isActive`
- [x] First migration committed — `prisma/migrations/20260727182447_create_restaurant/`
- [x] Shared Prisma client — `@repo/database` exports a `db` singleton using the `PrismaPg` adapter
- [x] Database connectivity verified end-to-end (create / read / delete against the real table)

**Why port 5433 and not 5432:** a pre-existing native Windows PostgreSQL service occupies 5432 on
this machine and silently won connections intended for the container, which produced a long
debugging session that looked like a Prisma bug. Moving this project to 5433 removed the
ambiguity. Full write-up in `AI_ENGINEER.md`. Do not change this back.

**Honest caveat:** the database verification was performed manually (a script exercising
create/read/delete, cross-checked with `psql`). It is **not** a committed automated test — no test
runner exists in the repository yet. That gap is addressed in Phase 3.

---

## PHASE 2 — Restaurant Backend

**Status: COMPLETED**

The first real product module, and the template every future module follows.

- [x] `restaurants` module — `apps/api/src/modules/restaurants/`
- [x] Repository layer — `restaurant.repository.ts` (Prisma access only)
- [x] Service layer — `restaurant.service.ts` (slug generation, uniqueness rules)
- [x] Controller layer — `restaurant.controller.ts`
- [x] Routes layer — `restaurant.routes.ts`
- [x] Zod validation via shared `@repo/validation` package (new in this phase)
- [x] Pagination on the list endpoint (`page`, `limit` capped at 100, `isActive` filter)
- [x] Centralised error handling — `shared/error-handler.ts`, domain errors in `shared/errors.ts`
- [x] Consistent response envelope — `{ success, data }` / `{ success: false, error }`

**Endpoints delivered:**

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/restaurants` | Paginated list |
| GET | `/restaurants/:id` | `404` when absent |
| POST | `/restaurants` | Slug auto-generated from name; `409` on duplicate |
| PATCH | `/restaurants/:id` | Partial update |
| DELETE | `/restaurants/:id` | `204` on success |

All five were exercised against the running database, with results independently confirmed via
`psql` rather than trusting the API's own responses. `lint` and `check-types` pass across the
workspace.

**Known limitation:** these endpoints are **unauthenticated**. Anyone able to reach the API can
modify any restaurant. Acceptable only because nothing is deployed. Closed in Phase 4.

---

## PHASE 3 — Backend Infrastructure

**Status: COMPLETED**

Made the backend operable and testable *before* the surface area grew.

- [x] Configuration management — `src/config.ts` is the only reader of `process.env`
- [x] Environment validation — Zod-validated at startup; the process exits with a readable list
      of problems rather than failing later on a mysterious `undefined`
- [x] Structured logging — JSON, four levels, request-scoped child loggers, recursive redaction
      of password/token/cookie/secret-like keys
- [x] Request IDs — on every request, in the `X-Request-Id` header, in every log line, and in
      error response bodies
- [x] Health endpoint — `GET /health`, checks no dependencies
- [x] Readiness endpoint — `GET /ready`, verifies PostgreSQL, `503` when unavailable
- [x] CORS — explicit origin allow-list from configuration, `credentials: true`, never `*`
- [x] Security middleware — secure headers, 1 MB body limit, rate limiting on auth endpoints
- [x] OpenAPI specification — generated from the same Zod schemas the API validates with, so
      documented constraints cannot drift from enforced ones; served at `/openapi.json` and `/docs`
- [x] Backend testing foundation — `bun test`, isolated `restaurant_platform_test` database,
      in-process requests via `app.request()`, safety interlock against non-test databases

Implemented with **zero new dependencies** — Hono ships `request-id`, `cors`, `secure-headers`,
and `body-limit`, and Zod 4 generates JSON Schema natively.

Also closed here: `apps/api` previously had no `build` script (so `turbo run build` silently
skipped it) and no `test` script. Both now exist, and `turbo.json` knows about `dist/**`.

---

## PHASE 4 — Authentication & Authorization

**Status: COMPLETED**

- [x] Authentication — Better Auth, email + password (12 char minimum), library-managed hashing
- [x] Session handling via `httpOnly`, `SameSite=Lax` cookies (`Secure` in production), 7-day
      expiry refreshed at most daily
- [x] `User` model (plus `Session`, `Account`, `Verification` — Better Auth's schema)
- [x] `RestaurantMembership` model linking users to restaurants
- [x] `OWNER` and `STAFF` roles, mapped through named capabilities rather than role checks
      scattered across routes
- [x] Authorization enforced in middleware (`requireAuth` → 401) plus the service layer
      (`membershipService.authorize` → 403)
- [x] Restaurant endpoints moved behind authentication and membership scoping

**Library choice:** Better Auth was selected over hand-rolled sessions because password hashing,
session lifecycle, and cookie handling are security-critical and easy to get subtly wrong. It is
used for **authentication only** — the `RestaurantMembership` model is ours, deliberately not
Better Auth's generic `organization` plugin, which would have renamed a core domain concept and
added invitation/team tables the product does not need yet.

**Breaking change, as anticipated:** the Phase 2 endpoints moved. `POST/PATCH/DELETE
/restaurants` are now `/admin/restaurants` and require a session; `GET /restaurants` remains
public but returns only active restaurants with a reduced field set, and single lookups are by
slug rather than internal id.

Verified by test: a non-member receives `403` on read, update, and delete; a rejected update
leaves the record unchanged; and "not a member" is indistinguishable from "does not exist".

---

## PHASE 5 — Restaurant Management

**Status: NEXT**

Expand a restaurant from a thin record into a manageable profile.

- [ ] Restaurant profile management
- [ ] Branding fields (logo reference, colours) — the assets themselves arrive in Phase 7
- [ ] Restaurant settings
- [ ] Operating hours
- [ ] Contact information

Operating hours deserve real thought when this phase starts (overnight spans, per-day variation,
holidays, timezones). Deliberately not designed yet.

---

## PHASE 6 — Menu Management

**Status: PLANNED**

The core product value: the menu itself.

- [ ] `categories` module — sibling of `restaurants`
- [ ] `menu-items` module
- [ ] Item descriptions
- [ ] Prices — stored as integer minor units, never floating point
- [ ] Availability (an item can be hidden without deletion)
- [ ] Explicit ordering/display position for categories and items
- [ ] Menu item image references (upload mechanics land in Phase 7)

Both modules follow the routes → controller → service → repository structure established in
Phase 2, and every query is scoped by `restaurantId`.

---

## PHASE 7 — Media

**Status: PLANNED**

- [ ] Image upload flow
- [ ] Cloudflare R2 integration (S3-compatible, no egress fees)
- [ ] Direct-to-storage uploads via presigned URLs — image bytes never pass through the API
- [ ] Image optimization
- [ ] Responsive image variants
- [ ] Restaurant branding assets
- [ ] Menu item images

Files must never be written to the API server's filesystem — that would break horizontal scaling
and lose data on container restart. See `ARCHITECTURE.md` §12.

---

## PHASE 8 — QR & Public Menu

**Status: PLANNED**

The customer-facing experience — the reason the product exists.

- [ ] QR code generation per restaurant
- [ ] Public restaurant URL resolved by `slug`, never by internal ID
- [ ] Customer mobile experience
- [ ] Menu browsing
- [ ] Category display
- [ ] Menu item display
- [ ] Responsive design

Public endpoints are read-only, unauthenticated, and must expose only active restaurants and
published menu content. They are also the highest-traffic and most cacheable surface in the
system, so caching strategy belongs in this phase rather than being deferred to Phase 10.

---

## PHASE 9 — Frontend

**Status: PLANNED**

Both applications are currently untouched starter scaffolds. This phase makes them real.

**`apps/web` — public customer experience**

- [ ] Menu browsing UI built on the Phase 8 public API
- [ ] Server-rendered / statically generated for speed and indexability

**`apps/admin` — restaurant owner dashboard**

- [ ] Authenticated console for restaurant, category, and menu item management
- [ ] Forms validated with the shared `@repo/validation` schemas the API already enforces

**Cross-cutting requirements**

- [ ] Mobile-first — customers are on phones, often on poor restaurant Wi-Fi
- [ ] Responsive
- [ ] Accessible
- [ ] Fast
- [ ] SEO-friendly public pages

**Foundational work this phase must also cover**, since it does not exist yet:

- [ ] Install and configure `shadcn/ui` (agreed component approach, currently not installed)
- [ ] Tailwind CSS in `apps/web` (currently configured only in `apps/admin`)
- [ ] Populate `@repo/ui` with real shared components (it still holds starter samples)
- [ ] Add a `check-types` script to `apps/admin`

---

## PHASE 10 — Production Platform

**Status: FUTURE**

Nothing is deployed today. Scope here is intentionally loose and will be refined when a real
deployment target is chosen.

- [ ] Caching strategy
- [ ] CDN
- [ ] Observability — metrics, tracing, error tracking
- [ ] Rate limiting
- [ ] Database backups with a **tested** restore procedure
- [ ] CI/CD pipeline running the same `lint` / `check-types` / test checks as local development
- [ ] Staging environment mirroring production
- [ ] Production environment
- [ ] Monitoring and alerting
- [ ] Product analytics
- [ ] Performance optimization

---

## Working rules for this roadmap

1. **Do not mark planned work as implemented.** A checkbox is ticked when the code exists and has
   been verified, not when it has been designed.
2. **Do not invent scope.** Features not discussed do not belong here.
3. **The roadmap is adaptable.** Phases may be reordered or resized as the product is understood
   better. Order reflects dependency, not commitment.
4. **No premature microservices.** The modular monolith stays until there is a concrete, evidenced
   reason to split — see `ARCHITECTURE.md` §3.2.
5. **No unnecessary infrastructure.** Add a component when a real problem demands it, not in
   anticipation.
6. **Incremental implementation.** One reviewed step at a time, per `AI_ENGINEER.md`.

---

## Immediate housekeeping (independent of phases)

Small items worth resolving soon; none belong to a specific phase.

- [ ] **Commit the work.** Only the original `create-turbo` commit exists in git. Everything since
      — `apps/admin`, `apps/api`, `packages/database`, `packages/validation`, `docker-compose.yml`,
      and the documentation — is untracked and unprotected.
- [ ] Remove `apps/docs` (leftover starter sample, not part of the product).
- [ ] Resolve the port collision: `apps/docs` and `apps/api` both default to 3001.
- [x] ~~Fix the rate-limiter bypass (audit finding, HIGH).~~ **Done** — identity now comes from
      the real TCP peer address, with `X-Forwarded-For` honoured only behind a configured trusted
      proxy (`TRUSTED_PROXY_IPS`). Verified over real HTTP: 40 requests with rotating forged
      headers now yield exactly the configured limit instead of all succeeding.
- [x] ~~Fix `isActive` filtering (audit finding, MEDIUM).~~ **Done** — explicit
      `z.enum(["true","false"])` parsing; anything else is a 400 rather than a guess.
- [x] ~~Add value-based log redaction (audit finding, MEDIUM).~~ **Done** — credentials inside
      strings, `Error` messages, and stack traces are stripped.
- [x] ~~Correct the two OpenAPI inaccuracies (audit finding, LOW).~~ **Done**, plus an automated
      conformance test so the document cannot silently drift from behaviour again.
- [ ] Move the in-process rate limiter to a shared store (Redis) before running more than one API
      instance — until then each instance enforces the limit independently.
- [ ] Wire up transactional email, then enable email verification and add a password-reset flow.
      Until this exists a forgotten password has no self-service recovery path.
- [ ] Add a member-management API (invite staff, change roles). The `member:manage` capability
      and `RestaurantMembership` model exist; no endpoints use them yet, so a restaurant
      currently cannot add a second user.
