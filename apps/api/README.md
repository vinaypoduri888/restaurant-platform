# Restaurant Platform API

Backend for the Digital Restaurant Experience Platform — Bun + Hono, PostgreSQL via Prisma,
organised as a modular monolith.

See also: [`ARCHITECTURE.md`](../../ARCHITECTURE.md) (design and rationale),
[`AI_ENGINEER.md`](../../AI_ENGINEER.md) (conventions and known environment issues),
[`PROJECT_ROADMAP.md`](../../PROJECT_ROADMAP.md) (what is done and what is next).

---

## Local setup

From the repository root:

```sh
bun install
```

### 1. Start PostgreSQL

```sh
docker compose up -d
```

This runs PostgreSQL 17 as container `restaurant-platform-db` on **host port 5433**.

> **The port is 5433 on purpose — do not change it to 5432.** This machine runs a separate
> native Windows PostgreSQL service on 5432 which silently wins connections intended for the
> container. Full explanation in `AI_ENGINEER.md`. If a Prisma command ever seems to "lie"
> about the database state, check this first.

Wait for the healthcheck before using it:

```sh
docker inspect --format='{{.State.Health.Status}}' restaurant-platform-db   # -> healthy
```

### 2. Configure environment

```sh
cp apps/api/.env.example apps/api/.env
```

Then generate a real signing secret and put it in `.env`:

```sh
bun -e 'console.log(crypto.randomUUID().replace(/-/g,"")+crypto.randomUUID().replace(/-/g,""))'
```

### 3. Apply migrations

```sh
cd packages/database
bun run prisma migrate deploy
```

### 4. Run the API

```sh
cd apps/api
bun run dev        # watch mode
```

The API listens on <http://localhost:3001>. Confirm with:

```sh
curl http://localhost:3001/health   # {"status":"ok"}
curl http://localhost:3001/ready    # {"status":"ok","checks":{"database":"ok"}}
```

---

## Environment variables

Validated by Zod at startup (`src/config.ts`). **The process refuses to start if any required
variable is missing or malformed** — a clear failure at boot beats a confusing one later.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | **yes** | — | PostgreSQL connection string. Must be port **5433** locally. |
| `BETTER_AUTH_SECRET` | **yes** | — | Signs session cookies. Minimum 32 chars, unique per environment. |
| `API_PORT` | no | `3001` | Listening port. |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production`. |
| `CORS_ORIGINS` | no | `http://localhost:3000,http://localhost:3002` | Comma-separated origin allow-list. Never `*`. |
| `BETTER_AUTH_URL` | no | `http://localhost:3001` | Public base URL, for auth callbacks. |
| `LOG_LEVEL` | no | `debug` (`info` in production) | `debug` \| `info` \| `warn` \| `error`. |
| `BODY_LIMIT_BYTES` | no | `1000000` | Maximum request body size. |
| `AUTH_RATE_LIMIT_MAX` | no | `20` | Auth attempts allowed per client per window. |
| `AUTH_RATE_LIMIT_WINDOW_MS` | no | `60000` | Rate-limit window length. |
| `TRUSTED_PROXY_IPS` | no | *(empty)* | IPs/CIDRs permitted to set `X-Forwarded-For`. Empty means no proxy is trusted. See below. |

`.env` is git-ignored and must never be committed. `.env.example` documents the shape;
`.env.test` is committed deliberately because it contains only local test values.

### Rate limiting and trusted proxies

Sign-up and sign-in are rate limited per client (default 20 per minute). Ordinary API traffic is
not rate limited.

**Client identity comes from the real TCP peer address, never from a header by default.**
`X-Forwarded-For` is attacker-controlled on a direct connection: if it were trusted blindly, a
client could rotate it and get an unlimited number of rate-limit buckets. That was a confirmed
audit finding and is now covered by regression tests.

`TRUSTED_PROXY_IPS` controls when forwarding headers may be believed:

| Deployment | Setting | Behaviour |
| --- | --- | --- |
| Local development (default) | empty | `X-Forwarded-For` ignored entirely; identity is the peer address. |
| Behind a load balancer | the balancer's address, e.g. `10.0.0.0/8` | Header honoured **only** for requests arriving from that address. |

When the peer is a trusted proxy, `X-Forwarded-For` is walked **from the right**, discarding hops
that are themselves trusted proxies, and the first untrusted address wins. Entries a client forged
sit further left and are never reached.

Accepted formats: exact IPs (`10.0.0.4`), IPv4 CIDRs (`10.0.0.0/8`), and IPv6-mapped IPv4
(`::ffff:10.0.0.4`, normalised automatically).

> **IPv6 gotcha:** a connection to `localhost` normally arrives from `::1`, not `127.0.0.1`. If
> you need loopback trusted, list both: `TRUSTED_PROXY_IPS="127.0.0.1,::1"`.

Misconfiguring this is fail-safe: listing too few proxies means everyone behind the balancer
shares one bucket (over-limiting), never that the limiter can be bypassed.

The limiter is in-process, so each API instance counts independently. That is fine for a single
instance; a shared store (Redis) is required before scaling horizontally.

### Logging and redaction

Logs are structured JSON. Two layers of redaction apply:

1. **By key** — any key matching `password`, `token`, `secret`, `authorization`, `cookie`,
   `credential`, `apikey`, … is replaced with `[REDACTED]` at any nesting depth.
2. **By value** — credentials embedded in *strings* are stripped, including inside `Error`
   messages and stack traces. This matters because a database driver that cannot connect
   typically puts the whole DSN in its error message, where no key check would apply.

Value redaction removes the password from any URI (`postgresql://user:[REDACTED]@host/db`) and
replaces exact matches of `DATABASE_URL` and `BETTER_AUTH_SECRET` wherever they appear. The
scheme, user, host, and database name deliberately survive — those are what make a connection
error diagnosable.

---

## Prisma commands

Run these from `packages/database`.

> **Always `bun run prisma …`, never `bunx prisma …`.** On this machine `bunx` delegates to an
> older system Node that crashes inside a Prisma dependency. The `prisma` script routes through
> Bun's runtime, which does not. See `AI_ENGINEER.md`.

```sh
bun run prisma migrate dev --name <change_name>   # create + apply a migration (development)
bun run prisma migrate deploy                     # apply pending migrations (CI / production)
bun run prisma migrate status                     # what is applied vs pending
bun run prisma generate                           # regenerate the client
bun run prisma studio                             # browse data
```

### Migration procedure

1. Edit `packages/database/prisma/schema.prisma`.
2. `bun run prisma migrate dev --name <descriptive_name>` — writes SQL to
   `prisma/migrations/<timestamp>_<name>/` and applies it locally.
3. **Verify against the database directly** rather than trusting CLI output:
   ```sh
   docker exec restaurant-platform-db psql -U postgres -d restaurant_platform -c '\dt'
   ```
4. Review the generated `migration.sql` before committing — it is the artifact that will run
   against production.
5. Commit the migration directory together with the schema change.

**Deployment:** run `bun run prisma migrate deploy` as an explicit step *before* the new version
serves traffic — never automatically on application boot, where concurrent instances would race.

**Never** run `migrate reset` or `db push` against a database holding real data; both are
destructive. `db push` in particular skips migration history entirely.

### Regenerating the client

`prisma generate` in this environment can intermittently produce an incomplete client (a known
Prisma 7.9.1 defect — see `AI_ENGINEER.md`). A non-zero exit code is *not* a reliable signal, and
neither is a zero one. After generating, verify real content:

```sh
cd packages/database
find generated -type f -exec sh -c 'echo "$(wc -c < "$1") $1"' _ {} \;
```

Every file — including everything under `internal/` and `models/` — must be non-empty.

**Checking for empty files is not enough.** A later run can *delete* files an earlier one wrote,
so a directory holding 5 correct files and a directory holding all of them both report "no empty
files". Check the count as well: every expected file, none empty, no empty directories.

**Derive the expected count — it is not a constant.** The generator emits one file per model, so
it grows with the schema (it was 16, then 18, and is 19 as of the slug-history migration):

```sh
EXPECTED=$(( $(grep -c '^model ' prisma/schema.prisma) + 8 ))
```

The 8 fixed files are `browser.ts`, `client.ts`, `commonInputTypes.ts`, `enums.ts`, `models.ts`
and three under `internal/`.

If runs will not converge, accumulate across them — the output is deterministic for a given
schema, so merging non-empty files from successive runs is safe and reliably terminates:

```sh
STAGE=/tmp/prisma-stage; rm -rf "$STAGE"; mkdir -p "$STAGE"
for i in $(seq 1 25); do
  bun run prisma generate >/dev/null 2>&1
  while IFS= read -r f; do
    rel="${f#generated/}"
    [ -s "$STAGE/$rel" ] || { mkdir -p "$STAGE/$(dirname "$rel")"; cp "$f" "$STAGE/$rel"; }
  done < <(find generated -type f -size +1c)
  [ "$(find "$STAGE" -type f -size +1c | wc -l)" -ge "$EXPECTED" ] && break
done
rm -rf generated && cp -r "$STAGE" generated
```

Then confirm the client actually imports and reaches the database:

```sh
cd ../../apps/api && bun -e 'const { db } = await import("@repo/database"); console.log(await db.restaurant.count())'
```

---

## Development

```sh
bun run dev          # watch mode
bun run start        # run once
bun run build        # bundle to dist/
bun run lint         # eslint, zero warnings tolerated
bun run check-types  # tsc --noEmit
bun run test         # bun test against the isolated test database
```

### Testing

Tests run in-process through Hono's `app.request(...)` — no port binding, no server lifecycle to
manage — against a **separate `restaurant_platform_test` database** so development data is never
touched.

One-time setup:

```sh
docker exec restaurant-platform-db psql -U postgres -c "CREATE DATABASE restaurant_platform_test;"
cd packages/database
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/restaurant_platform_test?schema=public" \
  bun run prisma migrate deploy
```

Then `bun run test` from `apps/api`.

Test helpers truncate tables between tests. As a safety interlock they **refuse to run unless the
target database name ends in `_test`**, so a misconfigured `DATABASE_URL` fails loudly instead of
destroying development data.

Coverage focuses on business-critical behaviour: authentication, cross-tenant authorization,
validation, duplicate-slug races, pagination correctness, public/admin field separation, and the
health endpoints.

---

## API documentation

With the server running:

- **<http://localhost:3001/docs>** — interactive reference
- **<http://localhost:3001/openapi.json>** — raw OpenAPI 3.0 document

The specification is generated from the same Zod schemas the API validates with, so documented
constraints cannot drift from enforced ones.

---

## Health endpoints

| Endpoint | Meaning | Use for |
| --- | --- | --- |
| `GET /health` | The process is alive. Checks no dependencies. | Liveness probe — restart if failing. |
| `GET /ready` | Dependencies reachable (currently PostgreSQL). `503` when not. | Readiness probe — stop routing traffic if failing. |

They are deliberately distinct: a database outage should remove an instance from the load
balancer, not cause an orchestrator to kill an otherwise healthy process.

---

## Authentication

Handled by [Better Auth](https://www.better-auth.com), mounted at `/api/auth/*`, backed by the
same PostgreSQL database through Prisma.

- Email + password, minimum 12 characters. Passwords are hashed by Better Auth — plaintext is
  never stored.
- Sessions live in `httpOnly`, `SameSite=Lax` cookies (`Secure` in production), so client-side
  JavaScript cannot read them.
- Sessions last 7 days, refreshed at most daily.
- Sign-up/sign-in are rate limited.

```sh
# Register (sets a session cookie)
curl -X POST http://localhost:3001/api/auth/sign-up/email \
  -H 'Content-Type: application/json' -c cookies.txt \
  -d '{"email":"owner@example.test","password":"a-long-enough-password","name":"Owner"}'

# Use the session
curl -b cookies.txt http://localhost:3001/admin/restaurants
```

### Authorization

Access is granted by **membership**, not by a flag on the user:

```
User ──< RestaurantMembership (OWNER | STAFF) >── Restaurant
```

Creating a restaurant makes the creator its `OWNER`, in the same transaction as the insert.

Routes ask for a *capability*, never for a role; `membership.service.ts` maps roles to
capabilities in one table. Adding a role later changes that table, not every route.

| Capability | OWNER | STAFF |
| --- | --- | --- |
| `restaurant:read` | ✅ | ✅ |
| `restaurant:update` | ✅ | ✅ |
| `restaurant:delete` | ✅ | ❌ |
| `member:manage` | ✅ | ❌ |
| `menu:read` | ✅ | ✅ |
| `menu:write` | ✅ | ✅ |
| `menu:delete` | ✅ | ❌ |

Menu policy mirrors restaurant policy: staff do the day-to-day work, owners take the irreversible
actions. Marking a dish sold out or correcting a price is exactly what floor staff are there for,
so `menu:write` is theirs. Deletion destroys content, and staff already have `isActive` /
`isAvailable` to take something off the menu reversibly — so `menu:delete` is OWNER only.

Requesting a restaurant you are not a member of returns **403 — the same response as a
non-existent id**, so the API never confirms which identifiers are real.

---

## Endpoints

### Public — no authentication

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/restaurants` | Active restaurants only, reduced fields, paginated. |
| `GET` | `/restaurants/:slug` | By slug, not internal id. Includes operating hours and an open/closed status. `404` if missing or inactive. |
| `GET` | `/restaurants/:slug/menu` | The published menu: active categories in order, each with its active items in order. |

Public responses deliberately omit `email`, `phone`, `isActive`, and timestamps.

#### Operating hours and open/closed status

`GET /restaurants/:slug` carries the restaurant's time zone, its published week, and whether it
is open right now:

```jsonc
{
  "timeZone": "Asia/Kolkata",
  "status": "open",                 // "open" | "closed" | "unknown"
  "hours": [
    { "dayOfWeek": "MONDAY", "isClosed": false, "opensAt": 540, "closesAt": 1020, "isOvernight": false },
    { "dayOfWeek": "FRIDAY", "isClosed": false, "opensAt": 1320, "closesAt": 120, "isOvernight": true },
    { "dayOfWeek": "SUNDAY", "isClosed": true,  "opensAt": null, "closesAt": null, "isOvernight": false }
  ]
}
```

- **Times are minutes past *local* midnight** (0–1439) in the restaurant's own zone. 540 is 09:00
  wherever the restaurant stands, in winter and in summer.
- **`status` is computed server-side** in the restaurant's zone, from the instant of the request.
  It is never derived from the visitor's clock — a customer in London reading a Mumbai menu must
  be told whether it is open in Mumbai.
- **`unknown` means no hours are configured.** Deliberately not `closed`: an owner who has not
  filled the form in has not said they are shut.
- **`closesAt < opensAt` is an overnight period** — 22:00–02:00 — kept as one row rather than
  split across two days. `isOvernight` is derived by the API so clients need not re-implement it.
- **Boundaries are half-open, `[opensAt, closesAt)`**: open at the opening minute, closed at the
  closing minute.
- **Cache note:** the page is revalidated every 60 seconds, so `status` can be up to a minute
  stale around an opening or closing time. The published hours beside it are always exact.

**The menu is returned as one unpaginated document**, because a menu is a single document to a
customer — a phone at a table showing half a menu is a failed product. It stays bounded by
capping at write time instead: 100 categories per restaurant, 200 items per category. Both are
guardrails against data-entry errors, not product limits.

A sold-out item is returned with `isAvailable: false` rather than omitted; silently removing a
dish makes a customer think the menu is broken. An unpublished item (`isActive: false`) is
omitted entirely.

Prices cross the wire as exact integers with the information needed to interpret them:

```jsonc
"price": { "amountMinor": 1250, "currency": "USD", "minorUnits": 2 }
// major units = amountMinor / 10 ** minorUnits  →  12.50
```

`minorUnits` is not always 2 — JPY has 0, KWD has 3 — so assuming two decimal places would
misprice a menu by a factor of a hundred in those markets.

**`isActive` query parameter** (admin list only) accepts exactly `true` or `false`:

| Query | Returns |
| --- | --- |
| `?isActive=true` | Active restaurants only |
| `?isActive=false` | Inactive restaurants only |
| omitted | Both |
| anything else (`yes`, `1`, `0`, empty) | `400` — rejected rather than guessed |

The two literals are parsed explicitly rather than coerced. `z.coerce.boolean()` cannot be used
for query strings: it applies JavaScript `Boolean()` semantics, so `"false"` would become `true`.

### Admin — session required, membership scoped

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/admin/restaurants` | Only the caller's restaurants. Supports `page`, `limit`, and `isActive`. |
| `GET` | `/admin/restaurants/:id` | Full record **plus the caller's own role** — `{ restaurant, role }`. |
| `POST` | `/admin/restaurants` | Creator becomes `OWNER`. Slug auto-generated if omitted. |
| `PATCH` | `/admin/restaurants/:id` | Partial update. |
| `DELETE` | `/admin/restaurants/:id` | `OWNER` only. |

#### Why the detail response reports a role

`GET /admin/restaurants/:id` returns the caller's membership role alongside the record:

```jsonc
{ "success": true, "data": { "restaurant": { /* ... */ }, "role": "OWNER" } }
```

It exists so a management UI can hide controls the caller cannot use — offering a staff member
a delete button that always refuses reads as a bug rather than a boundary.

- The value is read from the `RestaurantMembership` row that `membershipService.authorize`
  already loaded to make its decision, so there is **no extra query** and the role cannot be
  obtained without passing authorization first.
- It is never taken from the request. There is no code path that reads a role, `userId`, or
  membership id from a body, query, or path.
- It is **informational**. Every write re-authorizes independently, so a client that ignored or
  forged it would gain nothing.
- A non-member still gets `403` — the same answer as for an id that does not exist — with no
  role in the body.

The list endpoint is unchanged and reports no role.

### Menu — session required, membership scoped

The restaurant is always in the **path**, so the tenant is covered by the same validation and
authorization on every route and a body field claiming a different restaurant has nowhere to take
effect.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/admin/restaurants/:restaurantId/hours` | The full week, always seven days, Monday first. Unconfigured days read as closed. |
| `PUT` | `/admin/restaurants/:restaurantId/hours` | Replaces the whole week atomically. All seven days required, exactly once. |
| `GET` | `/admin/restaurants/:restaurantId/categories` | Paginated. Supports `isActive`. Each row carries `menuItemCount`. Includes hidden categories. |
| `POST` | `/admin/restaurants/:restaurantId/categories` | Slug derived from `name` if omitted; unique per restaurant. Appends to the end unless `position` is given. |
| `GET` | `/admin/restaurants/:restaurantId/categories/:categoryId` | |
| `PATCH` | `/admin/restaurants/:restaurantId/categories/:categoryId` | Partial update. |
| `DELETE` | `/admin/restaurants/:restaurantId/categories/:categoryId` | `OWNER` only. `409` while it still holds items; `?force=true` deletes them with it. |
| `GET` | `/admin/restaurants/:restaurantId/menu-items` | Paginated. Supports `categoryId`, `isActive`, `isAvailable`. |
| `POST` | `/admin/restaurants/:restaurantId/menu-items` | `categoryId` in the body; it must belong to the same restaurant. |
| `GET` | `/admin/restaurants/:restaurantId/menu-items/:menuItemId` | |
| `PATCH` | `/admin/restaurants/:restaurantId/menu-items/:menuItemId` | Partial update. Supplying `categoryId` moves the item between sections. |
| `DELETE` | `/admin/restaurants/:restaurantId/menu-items/:menuItemId` | `OWNER` only. |

Hours use `PUT` rather than `PATCH` because the payload carries the complete week and replaces
it: the write is idempotent, and there is no question about what an omitted day would have meant.
They are governed by `restaurant:read` / `restaurant:update` — hours are profile data, so OWNER
and STAFF may both edit them, exactly like the rest of the profile.

The time zone lives on the restaurant and is changed through `PATCH /admin/restaurants/:id`. It
must be a named IANA identifier (`Asia/Kolkata`); a fixed offset such as `+05:30` is **rejected**,
because an offset cannot express daylight saving. New restaurants default to `UTC`.

Menu items are nested under the **restaurant**, not under the category, because an item's
category is mutable — moving a dish from "Mains" to "Specials" is ordinary menu work, and nesting
under the category would change the item's URL every time it moved.

`priceMinor` is a whole number of minor units (`1250` means 12.50). Decimals are **rejected, not
rounded**: `12.50` is ambiguous — 12 cents and a half, or 12.50 in major units? — and guessing
would decide what a customer is charged.

### Response envelope

```jsonc
{ "success": true,  "data": { } }
{ "success": true,  "data": { "items": [], "total": 0, "page": 1, "limit": 20 } }
{ "success": false, "error": { "message": "…", "requestId": "…" } }
{ "success": false, "error": { "message": "Validation failed", "requestId": "…", "issues": [] } }
```

| Status | Meaning |
| --- | --- |
| 400 | Validation failed |
| 401 | Not authenticated |
| 403 | Authenticated but not permitted |
| 404 | Not found |
| 409 | Conflict (duplicate slug) |
| 413 | Body too large |
| 429 | Rate limited |
| 500 | Unexpected — details logged server-side, never returned |

Every response carries an `X-Request-Id` header, echoed as `error.requestId`. Quote it when
reporting a problem; it correlates directly to the server logs.

---

## Troubleshooting

**`bunx prisma …` crashes with `ERR_REQUIRE_ESM`**
Use `bun run prisma …` instead. See `AI_ENGINEER.md`.

**Prisma reports success but the database looks unchanged**
Verify what is actually listening on the port — a native PostgreSQL service on 5432 previously
won connections meant for the container. Confirm `DATABASE_URL` uses **5433**, and cross-check
with a host `psql` connection rather than `docker exec` (which always talks to the container and
cannot reveal this class of problem).

**`prisma generate` leaves an unusable client**
Known Prisma 7.9.1 defect. Re-run without deleting, and verify file sizes as described above.

**API exits immediately at startup**
Configuration validation failed. The error lists exactly which variables are wrong. Most often
`BETTER_AUTH_SECRET` is missing or shorter than 32 characters.

**`docker compose up -d` cannot reach the Docker API**
Docker Desktop's WSL2 backend is still booting. Check `wsl -l -v` for `docker-desktop` in state
`Running`, then retry.

**Tests fail with `Refusing to run destructive test helpers`**
The safety interlock worked. `DATABASE_URL` was not pointing at a `_test` database — check
`NODE_ENV=test` and `apps/api/.env.test`.

**429 responses while testing auth locally**
Sign-up/sign-in are rate limited (20/minute by default). Raise `AUTH_RATE_LIMIT_MAX` or wait.

**Auth requests failing with 415, 400, or 403 `INVALID_ORIGIN`**
Better Auth requires `Content-Type: application/json`, a valid JSON body (`{}` is fine for
sign-out), and an `Origin` header matching `CORS_ORIGINS`. The last is CSRF protection working as
intended, not a bug.

---

## Known issues

From the security audit. None block frontend development; the first blocks public deployment.

The audit's High and Medium findings have been fixed and are covered by regression tests. What
remains is genuinely low-risk:

| Severity | Issue |
| --- | --- |
| Low | Rate limiting is in-process, so each API instance counts independently. Needs a shared store (Redis) before horizontal scaling. |
| Low | The public projection includes the internal `id`. Not sensitive (cuids are unguessable) but unnecessary — `slug` is the public handle. |
| Low | Timestamps are `timestamp without time zone`. Prisma consistently reads and writes UTC, so behaviour is correct today; `timestamptz` would be more robust for a multi-country product. |
| Low | No member-management API, so a restaurant cannot yet add a second user; STAFF memberships must be inserted directly. |
| Low | No transactional email, so email verification is disabled and there is no password-reset flow. |

**Fixed since the audit:** rate-limiter bypass via `X-Forwarded-For` (now uses the real peer
address with a configurable trusted-proxy model), `?isActive=false` inversion (explicit parsing),
value-level log redaction (DSNs in error messages), and two OpenAPI inaccuracies.
