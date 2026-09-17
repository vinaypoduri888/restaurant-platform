# AI Engineer Guide — Digital Restaurant Experience Platform

This file is the standing source of truth for any AI assistant (Claude, ChatGPT, etc.) working
in this repository. It is referenced by `CLAUDE.md` so Claude Code loads it automatically every
session — it does not need to be pasted into a prompt.

## What we're building

**Digital Restaurant Experience Platform** — a production-grade startup product. Architecture:

- Monorepo: Turborepo
- Package manager / runtime: Bun
- Frontend: `apps/web`, `apps/admin` (Next.js App Router)
- Backend: `apps/api` (Bun + Hono)
- Shared packages: `packages/database`, `packages/ui`, `packages/validation`, `packages/shared`
- Database: PostgreSQL via Docker (`docker-compose.yml`)
- ORM: Prisma
- Validation: Zod
- Storage: a provider-neutral `Storage` interface; `local` filesystem for development,
  Cloudflare R2 for production (selected by `STORAGE_DRIVER`, never by `NODE_ENV`)
- Styling: Tailwind CSS v4 with tokens in `@repo/ui`. **`shadcn/ui` is not installed** — its
  conventions are followed (cva variants, `cn`, token-driven colours), but the primitives are
  written directly in `@repo/ui`. Do not install it without asking

Pattern: **Monorepo + Modular Monolith. Not microservices.**

### Rules that don't change without being asked

1. Don't change the architecture above.
2. Don't introduce new frameworks/tools.
3. Don't rename or move folders without explaining why first.
4. Don't delete code without explaining why first.
5. Follow SOLID, Clean Architecture, Clean Code, DRY, KISS.
6. Service/repository pattern in the API — one responsibility per file.

## How to work in this repo (AI collaboration workflow)

This project is implemented incrementally, one reviewed step at a time — not generated in bulk.

- **Review before implementing.** When picking up new work, inspect the relevant part of the
  repo first and report before writing code: what exists, what's wrong or missing, why it
  matters, and the proposed fix. Wait for approval before implementing, unless explicitly told
  to proceed continuously.
- **After implementing anything**, report: files created, files modified, commands executed,
  any folder changes and why, and what should be committed to git vs. left ignored.
- **Commands one at a time** for anything state-changing (installs, migrations, generators) —
  run it, show the result, then move to the next step.
- **Debug before moving on.** If a command errors, find the actual root cause (see "Known
  environment issues" below before assuming something new) rather than routing around it
  silently.
- Package manager is **Bun** everywhere — don't reach for `npm`/`pnpm`/`yarn`.

## Folder & naming conventions

- Shared workspace packages are scoped `@repo/*` in `package.json` (`@repo/ui`, `@repo/database`,
  `@repo/eslint-config`, `@repo/typescript-config`). Apps (`web`, `admin`, `api`) are not scoped.
- Packages that export source directly (no build step) use an `exports` map pointing at `src/`
  — e.g. `packages/ui`'s `"./*": "./src/*.tsx"`, `packages/database`'s `".": "./src/client.ts"`.
  Consuming apps import the TypeScript source directly; Bun/Next.js handle the resolution.
- Prisma's generated client lives at `packages/database/generated/prisma` — never commit it
  (`.gitignore`'d), always regenerate via `prisma generate`.

## Current status

Phases 0–9 are complete: database, backend, authentication/authorization, the menu domain, the
restaurant profile with operating hours, branding media with a pluggable storage layer, QR codes
with slug history, and both frontends. See `PROJECT_ROADMAP.md` for phase detail and
`apps/api/README.md` for how to run and work on the API. **Only Phase 10 — deployment and
operations — remains, and none of it has been started.**

Done:
- Turborepo scaffold; `apps/docs` is leftover create-turbo sample content and not part of the product
- PostgreSQL via `docker-compose.yml` (`restaurant-platform-db`, **host port 5433** — see
  "Local development environment" below for why it's not 5432), with a `pg_isready` healthcheck
- `packages/database`: Prisma. Models `Restaurant`, `Category`, `MenuItem`, `OperatingHours`,
  `RestaurantMedia`, `RestaurantSlug`, `RestaurantMembership`, the `MediaPurpose` / `DayOfWeek` /
  `RestaurantRole` enums, plus the Better Auth tables. **Six migrations**, applied and verified
  directly against PostgreSQL, with hand-written CHECK constraints on `operating_hours`,
  `restaurant_media`, `restaurant_slugs` and `restaurants.slug`
- `packages/validation`: shared Zod schemas — `common`, `restaurant`, `category`, `menu-item`,
  `auth`, `operating-hours`, `media`
- `packages/ui`: design tokens plus shared primitives and `lib/{cn,money,opening-hours}`
- `apps/api` — complete backend: fail-fast typed config, structured logging with two-layer secret
  redaction, request IDs, health/readiness, centralised error handling, CORS allow-list, secure
  headers, a per-path body limit, auth rate limiting with trusted-proxy client identity, OpenAPI
  generated from the same Zod schemas the API validates with, Better Auth, capability-based
  membership authorization, the public read API, and the authenticated admin API
- `apps/api/src/shared/storage` — provider-neutral `Storage` interface with `local` and `r2`
  adapters chosen by `STORAGE_DRIVER`, never by `NODE_ENV`. R2 uses Bun's built-in `S3Client`, so
  it costs no dependencies. **R2 has never run against a live bucket** — see the roadmap
- `apps/api/src/shared/qr` — a QR encoder written here rather than installed (byte mode, level M,
  versions 1–20). Validated by decoding its own output the way a scanner does, and by checking its
  block table against the symbol's geometry. Do not swap it for a package without reading the
  Phase 8 notes in `PROJECT_ROADMAP.md`
- Slug history: a restaurant may rename its public URL, and every slug it has ever held stays
  reserved to it and keeps resolving, so printed QR codes survive a rename
- `apps/web` — the customer experience at `/r/[slug]`: restaurant header, banner and logo, full
  menu, opening hours with a server-computed open/closed status, JSON-LD, and
  loading/error/not-found boundaries
- `apps/admin` — sign-in/registration, restaurant selection and profile editing, the weekly hours
  editor, category/menu-item management, and the branding upload panel
- **941 tests** across the four workspaces (api 607, admin 141, web 110, `@repo/ui` 83), against
  an isolated `restaurant_platform_test` database

Not yet started:
- `packages/shared` (not created — nothing yet needs it)
- Production platform concerns (Phase 10) — deployment, CI/CD, observability, backups
- Presigned direct-to-storage uploads, image resizing/variants, and menu-item images — all
  deliberately deferred out of Phase 7; the reasoning is in `PROJECT_ROADMAP.md`
- Member management, password reset, and email verification — see the roadmap's housekeeping list
- Git: **almost nothing in this repo has been committed** past the initial `create-turbo` commit
  and one backend hardening commit. Flag this to the user; don't assume prior work is safe in git
  history.

## Known environment issues (don't re-debug these — apply the workaround)

This machine: Windows, Bun 1.3.14, Prisma 7.9.1, system Node v20.17.0 (+ Node v22.23.1 available
at `C:\Users\<user>\AppData\Roaming\nvm\v22.23.1\` via nvm-windows, not made the global default —
`nvm use` needs admin elevation that couldn't be granted non-interactively).

1. **Never use `bunx prisma <cmd>`.** On this setup `bunx` hands off to the system Node
   (v20.17.0), which is below the v20.19/v22.12 threshold where Node added native
   `require()`-of-ESM support. `@prisma/dev` (a transitive dep of `prisma`, pulled in even for
   commands unrelated to its local-dev-database feature) does `require("zeptomatch")`, and
   `zeptomatch` is pure ESM in every published version — so it hard-crashes
   (`ERR_REQUIRE_ESM`) under old Node. Checked npm: still broken as of `@prisma/dev@0.25.0`
   (the latest at time of writing), so there's no version bump that fixes it.
   **Always run `bun run prisma <cmd>`** instead (`packages/database/package.json` has a
   `"prisma"` script wired to `bun ./node_modules/prisma/build/cli.js`) — Bun's runtime natively
   supports `require()`-ing ESM modules, which sidesteps the crash entirely.
2. **`prisma generate` can silently write a corrupted, partially-empty (or partially *deleted*)
   client.** This IS a genuine, reproducible Prisma 7.9.1 CLI bug (confirmed via `DEBUG=prisma:*`:
   every invocation starts two concurrent internal engine/generator runs — visible as duplicated
   "Loaded Prisma config" / "starting Schema engine with binary" lines — regardless of Bun vs.
   Node, and regardless of whether `prisma.config.ts` is present). The two runs write
   `generated/prisma/*` concurrently and race per-file. This is NOT limited to leaving files
   empty — a later run can delete/overwrite files an earlier run in the *same* invocation just
   finished writing (observed: `internal/`/`models/` left as empty directories after 15
   consecutive attempts in one session). Reported exit code/success is not sufficient evidence
   the output is usable.
   **Safe procedure:** `rm -rf generated`, then run `bun run prisma generate` repeatedly (no
   fixed number — sometimes 1 attempt is enough, sometimes 15+ isn't) **without deleting between
   runs**, checking after every single run whether every file under `generated/prisma/**`
   (including everything in `internal/` and `models/`) has non-trivial size:
   `find generated -type f -exec sh -c 'echo "$(wc -c < "$1") $1"' _ {} \;`. Stop only once every
   expected file is non-empty. Do not just check the files exist or the command exited 0 — check
   real content. This has no known upstream fix as of Prisma 7.9.1/`@prisma/dev@0.25.0`.

   **Two refinements, learned the hard way on 2026-08-30 (menu domain migration):**

   a. **"No empty files" is not a sufficient stop condition.** Because runs *delete* files as
      well as truncate them, a directory containing only 5 of the expected files passes an
      emptiness check trivially — there is nothing empty in it. The predicate must be
      **expected file count AND no empty files AND no empty directories**.

      **The expected count is not a constant — do not hard-code it.** The generator emits one
      file per model under `generated/prisma/models/`, so the number grows every time the schema
      gains a model. It was 16 when this was first written and is **18** today (10 models: 6
      domain, 4 Better Auth). Derive it from the schema rather than trusting this sentence:
      count `^model ` in `schema.prisma` and add the 8 fixed files (`browser.ts`, `client.ts`,
      `commonInputTypes.ts`, `enums.ts`, `models.ts`, and three under `internal/`).

      Verified: a run reporting "0 empty files" produced a client that failed at import with
      `Cannot find module './internal/class.ts'`.

   b. **Repeated plain runs may never converge.** 15 consecutive attempts oscillated between 4
      and 14 of the then-16 files and never completed. What does work is **accumulating across
      runs into a staging directory**: generated output is deterministic for a given schema, so
      copying each run's non-empty files into a staging dir (never overwriting an already-staged
      file) converges — it completed in 9 runs. Then replace `generated/` with the staged copy.
      The exact script is in `apps/api/README.md` under "Regenerating the client".
3. **Prisma migration commands themselves are fine — the earlier "Prisma is lying" symptom was
   the port collision described below, not a Prisma bug.** Since moving to port 5433,
   `migrate dev`, `migrate deploy`, `migrate status`, `db pull`, and `db push` have all behaved
   correctly and been verified against the real database. Do not reintroduce the manual
   apply-SQL-by-hand workaround that was used before the root cause was found. (The duplicated
   internal execution is still visible in CLI output — harmless for migrations, but see issue 2
   for why it still matters for `generate`.)
4. **Docker Desktop stops between sessions on this machine.** Symptom: every database-backed
   test fails at once with Prisma `ECONNREFUSED`, and `docker ps` reports
   `failed to connect to the docker API at npipe:...dockerDesktopLinuxEngine`. This is the
   environment, not the code — check it before debugging anything else. Recovery:
   `wsl -l -v` (the `docker-desktop` distro will read `Stopped`), start
   `"C:\Program Files\Docker\Docker\Docker Desktop.exe"`, wait for `docker ps` to answer, then
   `docker compose up -d` and wait for
   `docker inspect --format='{{.State.Health.Status}}' restaurant-platform-db` to read `healthy`.
   Data survives — the volume is not lost.

5. `docker compose up -d` can fail with `unable to get image... dockerDesktopLinuxEngine` right
   after Docker Desktop launches — the backend WSL2 VM takes a bit to boot even once the tray
   app process is running. Check `wsl -l -v` for the `docker-desktop` distro state; wait for
   "Running" before retrying.

### Prisma CLI flag names changed in v7

`migrate diff` takes **`--from-schema` / `--to-schema`**, not the `--from-schema-datamodel` of
earlier versions, and there is no `--shadow-database-url` flag. Passing an unknown flag makes the
CLI print its help text and exit 1 rather than saying the flag is wrong — which reads like a
broken command. Working invocations:

```sh
# Does the live database match schema.prisma?
bun ./node_modules/prisma/build/cli.js migrate diff --from-schema ./prisma/schema.prisma --to-config-datasource

# Do the committed migrations reproduce schema.prisma? (replay into a throwaway database)
DATABASE_URL="...restaurant_platform_shadow" bun run prisma migrate deploy
DATABASE_URL="...restaurant_platform_shadow" bun ./node_modules/prisma/build/cli.js   migrate diff --from-config-datasource --to-schema ./prisma/schema.prisma
```

Both should print "No difference detected." Hand-written `CHECK` constraints in a migration do
**not** create drift — Prisma ignores them — so they are safe to add for invariants
`schema.prisma` cannot express.

## Local development environment (final, verified)

This machine has a **native Windows PostgreSQL 18 service** (`postgresql-x64-18`, auto-start,
pre-existing, used by unrelated other projects — do not stop or modify it) permanently bound to
port **5432**. That collided with Docker Desktop's port-forward for this project's container,
which was also configured for 5432 — on Windows, host-originated connections to `localhost:5432`
were won by the native service, not the container, with no error raised on either side.

**This looked exactly like a Prisma bug** (CLI reporting "already in sync" / "already applied"
while `docker exec`-verified queries showed the target table didn't exist) and cost significant
time to diagnose, because verifying via `docker exec` only ever checks the container directly —
it can't detect that a *different* server answered the connection Prisma actually made. Full
root-cause writeup: see the "senior engineer" conversation from 2026-07-27/28 if this needs
re-litigating; the short version is in the fix below.

**The fix:** this project's Postgres now runs on host port **5433**, not 5432, eliminating the
collision entirely.

- Container: `restaurant-platform-db` (was `restaurant-postgres`), `docker-compose.yml`
- Host port: **5433** → container port 5432 (`"5433:5432"`)
- Healthcheck: `pg_isready -U postgres`, so `docker ps` / `docker inspect` show real readiness
- `DATABASE_URL`: `postgresql://postgres:postgres@localhost:5433/restaurant_platform?schema=public`
- The native instance's `restaurant_platform` database had its `restaurants`/`_prisma_migrations`
  tables (created there by mistake, before the collision was diagnosed) dropped — that database
  is now empty and is **not** used by this project. Don't reintroduce port 5432 into any
  `DATABASE_URL` for this project.
- Before assuming a "Prisma is lying" scenario again: verify what's actually listening on the
  port in question — `netstat -ano | findstr ":<port>"` on Windows — and cross-check the server
  you reach with a plain `psql` connection from a **host** process (not `docker exec`, which
  always talks to the container directly and can't reveal this class of bug) against the
  container's actual version/locale (`postgres:17` image → server version 17.x, `en_US.utf8`).
