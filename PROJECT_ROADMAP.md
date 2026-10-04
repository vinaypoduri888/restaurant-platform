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

**Current position: Phases 0–9 complete. Phase 10 (production platform) is all that remains.**

Phases 6 and 9 were taken ahead of Phase 5: the menu is the product, and the customer page needs
something to render. Phase 5 was then completed as profile polish, and Phase 7 delivered media in
two passes — backend/storage first, then the frontend that consumes it.

```
  ✅ 0 ── ✅ 1 ── ✅ 2 ── ✅ 3 ── ✅ 4 ── ✅ 5 ── ✅ 6 ── ✅ 7 ── ✅ 8 ── ✅ 9 ── ▶ 10
 found.  database  restaurant  backend   auth  restaurant menu  media   QR     front  production
         foundation backend    infra                mgmt        codes   end
```

Every product phase is now built. Phase 10 is deployment and operations, and nothing in it has
been started — see its entry, and the honest caveats under Phases 7 and 8, before treating any of
this as production-ready.

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

**Status: COMPLETED**

Expand a restaurant from a thin record into a manageable profile.

- [x] Restaurant profile management — name, description, address, contact, currency, visibility
- [x] Operating hours — `OperatingHours`, one row per restaurant per day of the week
- [x] Restaurant time zone — IANA identifier on `Restaurant`
- [x] Server-side "open now / closed" calculation, from the restaurant's own zone
- [x] Public display of hours and status on `/r/[slug]`, including JSON-LD
- [x] Admin weekly hours editor on the restaurant overview page
- [x] Migration `20260830161548_add_operating_hours_and_timezone`, verified against PostgreSQL
- [x] Contact information — already present since Phase 2; deliberately **not** public
- [ ] Branding fields (logo reference, colours) — **deferred to Phase 7** with the media pipeline

**Design decisions worth carrying forward:**

- **Minutes past local midnight, not `TIME` columns.** Whether a restaurant is open depends on
  first converting an instant into its own wall clock; an integer carries no implicit zone.
- **An IANA zone, never a fixed offset.** `+05:30` cannot express daylight saving. Validation
  rejects offset forms explicitly, because `Intl` *accepts* them as time zone values — established
  by probing it, not assumed.
- **`UTC` is the default**, as the only value that is never subtly wrong: no DST, so an unset
  restaurant is off by a constant rather than by an amount that changes twice a year.
- **Overnight periods stay one row** (`closesAt < opensAt`), and the calculation looks back a day
  so Tuesday 01:00 is open under Monday's 22:00–02:00.
- **Boundaries are half-open, `[opensAt, closesAt)`** — open at the opening minute, closed at the
  closing minute.
- **No hours configured reports `unknown`, never `closed`** — an owner who has not filled the form
  in has not said they are shut.
- **Holidays and per-date exceptions are out of scope.** The roadmap flagged them as needing
  thought; nothing in the specification requires them, so none was invented.

---

## PHASE 6 — Menu Management

**Status: COMPLETED**

The core product value: the menu itself.

- [x] `categories` module — sibling of `restaurants`
- [x] `menu-items` module
- [x] Item descriptions (nullable; whitespace-only input normalised to `NULL`)
- [x] Prices — integer minor units, never floating point
- [x] Availability — `isAvailable` (sold out, still listed) distinct from `isActive` (unpublished)
- [x] Explicit `position` on categories and items, with a total, repeatable order
- [x] Public menu endpoint — `GET /restaurants/:slug/menu`
- [x] Migration `20260830060147_add_menu_domain`, verified directly against PostgreSQL
- [x] 122 new tests (database constraints, authorization, validation, ordering, tenant isolation)
- [ ] Menu item image references — **deferred to Phase 7 with the upload mechanics**

Both modules follow the routes → controller → service → repository structure established in
Phase 2, and every query is scoped by `restaurantId`.

**Image references were deliberately not added.** A column now would be a guess at a media
architecture that does not exist yet; adding a nullable `imageKey` in Phase 7 is a purely
additive migration, so nothing is lost by waiting.

**One change outside the menu domain:** `Restaurant.currency` (ISO 4217, defaults to `USD`). A
price without a currency is not a price, and a menu item can never be in a different currency
from the restaurant serving it — so it belongs on the restaurant, once. Also added to the public
restaurant projection and to create/update validation.

**Decisions worth carrying forward:**

- Deleting a category holding items is refused (`409`) rather than cascading; `?force=true` is
  the explicit opt-in. Enforced in PostgreSQL too, so orphans are impossible.
- A composite foreign key on `(category_id, restaurant_id)` makes cross-tenant item assignment
  impossible at the database level, not merely in application code.
- The public menu is a single unpaginated document, bounded by write-time caps (100 categories
  per restaurant, 200 items per category) rather than by pagination.
- `menu:read` / `menu:write` / `menu:delete` capabilities: STAFF write, OWNER deletes.

---

## PHASE 7 — Media

**Status: COMPLETED** — delivered in two passes, backend/storage (7) then frontend (7B).

Backend and storage:

- [x] Image upload flow — `multipart/form-data`, format determined from the file's magic bytes
- [x] Provider-neutral `Storage` interface with `local` and `r2` adapters
- [x] `STORAGE_DRIVER` selection, fail-fast when `r2` is chosen without credentials
- [x] Cloudflare R2 adapter via **Bun's built-in `S3Client`** — zero new dependencies
- [x] Restaurant branding assets — `LOGO` and `BANNER`
- [x] `RestaurantMedia` model, migration `20260831172134_add_restaurant_media`
- [x] Public branding on `GET /restaurants/:slug` — resolved URLs plus intrinsic dimensions
- [x] Storage cleanup on replacement, on media delete, and on restaurant delete
- [x] Per-path body limit, so a 5 MB upload is accepted without weakening the 1 MB JSON cap

Frontend (7B):

- [x] Public page renders the banner and logo when present, and is correct with neither
- [x] `next/image` with a `remotePatterns` allow-list pinned to the one media origin
- [x] Layout space reserved from the intrinsic dimensions the API reports — no shift on load
- [x] Logo carried into JSON-LD as `image`; the banner deliberately is not
- [x] Admin branding panel on the restaurant overview — preview, upload, replace, delete
- [x] Role-aware removal: `media:delete` is OWNER-only, and the API still enforces it
- [x] Upload constraints stated before a file is chosen; the API remains authoritative
- [x] `413` mapped to its own error, rather than falling through to "temporarily unavailable"

Deferred:

- [ ] **Direct-to-storage uploads via presigned URLs** — deferred, see below
- [ ] **Image optimization / responsive variants** — deferred, see below
- [ ] **Menu item images** — deferred; this phase was scoped to restaurant branding

**R2 is unverified against a live bucket.** There are no credentials in this environment, so the
adapter has never performed a real upload — it is covered structurally and by unit tests only.
Do not treat it as production-ready until someone runs it against a real bucket.

**The local adapter is development-only.** `ARCHITECTURE.md` §10 is explicit that production must
not write uploads to the API's own disk: it breaks horizontal scaling and the files vanish on
container restart. Production must set `STORAGE_DRIVER=r2`.

**Presigned uploads deferred, deliberately.** They cannot work for a local filesystem, so
shipping them first would have left development with no working upload path at all. Bytes
currently pass through the API, capped by `MEDIA_MAX_BYTES` (default 5 MB). Revisit when large
media or API throughput becomes a measured problem rather than an anticipated one.

**Image processing deferred, deliberately.** Resizing and re-encoding need a real decoder — a
native dependency this project does not otherwise carry, and a materially larger attack surface
than the header reader now in use. `next/image` already covers responsive sizing and modern
formats at render time (`FRONTEND_SPEC.md` §17). What *is* implemented is header parsing for
format detection and dimensions, which is what upload validation and layout reservation
actually require.

---

## PHASE 8 — QR Codes

**Status: COMPLETED**

The physical entry point: a code on the table that opens this restaurant's menu.

**Scope was reduced before implementation.** This phase was originally written as "QR & Public
Menu", but Phase 9 had already delivered the public menu experience — `/r/[slug]` resolved by
slug, category and item display, mobile-first layout, and the read-only public endpoints behind
it. What remained was genuinely QR-specific.

- [x] Slug history — `RestaurantSlug`, migration `20260917033724_add_restaurant_slug_history`
- [x] Retired slugs keep resolving, so a printed code survives a rename
- [x] Retired slugs stay reserved to their restaurant, permanently
- [x] Public page redirects a retired slug to the canonical URL (real `307`)
- [x] QR generation per restaurant, encoding the public `/r/[slug]` URL
- [x] `qr:read` capability, OWNER only, in the existing capability table
- [x] Owner-facing QR surface in `apps/admin` — preview, download, print sheet
- [x] ~~Public restaurant URL resolved by `slug`, never by internal ID~~ — Phase 9
- [x] ~~Customer mobile experience, menu browsing, category and item display~~ — Phase 9
- [x] ~~Responsive design~~ — Phase 9

**The slug decision: history and redirects, not immutability.** An owner may rename freely. Every
slug a restaurant has ever held is kept in `restaurant_slugs`, including the current one, and that
table's single `UNIQUE` index is what makes "a slug belongs to one restaurant forever" a database
guarantee rather than a service convention. PostgreSQL cannot spread a unique index across two
tables, so keeping only *retired* slugs there would have left nothing to stop restaurant B taking
restaurant A's retired slug as its current one.

**The redirect is temporary (307), not permanent (308).** A retired slug can become current again
— a typo fix, a reverted rebrand — and browsers and CDNs cache a permanent redirect indefinitely,
which would strand every scan of the reclaimed code. Search engines take the canonical URL from
`alternates.canonical`, which always names the current slug.

**QR generation has no dependency.** The encoder is written in `apps/api/src/shared/qr` — byte
mode, error-correction level M, versions 1–20. QR encoding is a closed, fully specified algorithm
with no I/O and no configuration, and the alternative pulls a package plus its dependency tree
into an API with six direct dependencies. The risk of hand-writing it is that a wrong table
produces a symbol that looks right and will not scan, so two independent checks guard it: the
block-structure table is validated against the symbol's geometry (which is derived without
reference to it), and the tests decode the output the way a scanner does — recovering the mask
from the format bits and verifying Reed–Solomon syndromes. **Both checks caught real bugs**
during development.

**Output is SVG only.** A QR code is a grid of squares, which vector graphics represent exactly;
an SVG prints crisply at any size with no resolution decision, and adding PNG would mean writing
a PNG encoder for a format that is worse for print.

**Nothing is stored.** A code is a pure function of the restaurant's current slug and the
configured public site URL, so it is generated on demand. There is no cached image to invalidate
after a rename, and `RestaurantMedia` stays what it is for — files a person uploaded that the
server could not otherwise reproduce.

**`qr:read` is OWNER only, and that is a product decision rather than a confidentiality one.** The
payload is a public URL; withholding it from staff protects no secret. What it protects is the
artefact — a printed code fixes the restaurant's public URL for as long as it is on the tables,
which is an owner's commitment to make. It lives in the capability table so the reasoning is
recorded in one place.

- [ ] **Bulk QR generation** (a sheet of codes per table) — not built; no table model exists
- [ ] **Scan analytics** — deliberately out of scope, and would need its own privacy decision
---

## PHASE 9 — Frontend

**Status: COMPLETED**

**`apps/web` — public customer experience**

- [x] Restaurant page at `/r/[slug]`, one renderer for every restaurant
- [x] Menu browsing: category sections, items, prices, availability, in-page section navigation
- [x] Server-rendered; the browser makes no API calls at all
- [x] Loading, empty, error, not-found states — with empty and error kept distinct
- [x] SEO metadata and JSON-LD built only from fields the API returns

**`apps/admin` — restaurant owner dashboard**

- [x] Sign in, register, sign out; session verified against the API, never decoded locally
- [x] Restaurant selection and profile editing
- [x] Category management: create, edit, hide, reorder, delete (with the 409 confirmation)
- [x] Menu item management: create, edit, move between sections, sold-out toggle, reorder,
      delete, plus server-side filtering and pagination
- [x] Forms validated with the shared `@repo/validation` schemas the API already enforces

**Cross-cutting**

- [x] Mobile-first, responsive, keyboard-operable, semantic
- [x] No stack traces, driver messages, or internal paths in any user-facing error
- [x] 192 frontend tests (web 63, admin 68, @repo/ui 61)

**Foundational work completed earlier in this phase:**

- [x] Tailwind CSS v4 in both apps, sharing `@repo/ui/styles/theme.css`
- [x] `@repo/ui` populated with real primitives, replacing the starter samples
- [x] `apps/admin` has `check-types` and now `test` scripts
- [ ] `shadcn/ui` is **not** installed. Its conventions are followed — cva variants, `cn`,
      token-driven colours — but the components are written in `@repo/ui` directly. Revisit
      only if a genuinely complex primitive (combobox, dialog) is needed.

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

- [x] ~~**Commit the work.**~~ **Done** — Phases 1–8 are committed on `main` as one snapshot
      (222 files, 26k insertions), verified green before committing. A pre-commit audit also found
      that `apps/web/.env.example` and `apps/admin/.env.example` were being silently excluded by
      create-turbo's blanket `.env*` rule, so a fresh clone had no record that `API_BASE_URL` or
      `MEDIA_PUBLIC_BASE_URL` exist; both are now opted back in.
- [x] ~~**Push somewhere.**~~ **Done** — `origin` is
      <https://github.com/vinaypoduri888/restaurant-platform> and `main` tracks `origin/main`, last
      verified at `f79a746`. The repository had been created with a README, whose root commit shared
      no ancestor with this history; that one placeholder commit was replaced by a single authorised
      `--force-with-lease` push. No implementation history was rewritten.
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
- [ ] Add a bulk reorder endpoint for categories and menu items. Reordering today is one `PATCH`
      per row, which an admin drag-and-drop UI would turn into N requests.
- [x] ~~Fix the admin category item counts above 100.~~ **Done** — the API now returns
      `menuItemCount` per category, counted by the database in the same query. The console
      previously derived it from one page of items and reported zero for anything past it.
- [x] ~~Add `currency` to `apps/web`'s `PublicRestaurant`.~~ **Done**, along with `timeZone`,
      `status`, and `hours`.
- [x] ~~Point `apps/web`'s `MenuSection` at `GET /restaurants/:slug/menu`.~~ **Done.**
- [x] ~~**Expose the caller's role on the admin API.**~~ **Done.** `GET /admin/restaurants/:id`
      now returns `{ restaurant, role }`. The role comes from the membership row `authorize`
      already read to make its decision, so there is no extra query and it cannot be obtained
      without passing authorization first. The console uses it to hide delete controls a STAFF
      member cannot use. Still informational only — every write re-authorizes independently.
- [ ] Give the admin sign-in form progressive enhancement. Forms rendered by Server Components
      get Next's hidden `$ACTION_ID` and submit without JavaScript; the `useActionState` forms
      in Client Components do not. Verified by inspecting both.
- [ ] Add on-demand revalidation for the public menu. `apps/web` tags every fetch with
      `restaurant:{slug}`, so the remaining work is a webhook from the API plus a Route Handler
      calling `revalidateTag`. Until then an owner's edit appears within 60 seconds.
