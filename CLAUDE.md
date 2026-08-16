# CLAUDE.md

@AI_ENGINEER.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. See `AI_ENGINEER.md` (referenced above, loaded automatically) for the project's architecture, engineering rules, AI collaboration workflow, current implementation status, and known environment issues/workarounds — don't duplicate that content here.

## Repository overview

This is a Turborepo monorepo (bun workspaces) for a restaurant platform, currently in early/scaffold stage:

- `apps/web` — Next.js 16 app (port 3000), uses shared `@repo/ui` and `@repo/eslint-config` packages. Part of the original create-turbo scaffold.
- `apps/docs` — Next.js 16 app (port 3001), same shared-package setup as `web`. Part of the original create-turbo scaffold.
- `apps/admin` — Next.js 16 app, standalone (does **not** use `@repo/ui` or `@repo/eslint-config`; has its own Tailwind v4 + eslint config). This is the actual admin dashboard for the restaurant platform being built and is where most new frontend work happens.
- `apps/api` — Backend API, built with [Hono](https://hono.dev) running on Bun (`@hono/node-server`), serves on port 3001. Entry point is `apps/api/index.ts`. Currently a bare scaffold (one `GET /` route) — not yet connected to `@repo/database`.
- `packages/database` — Shared Prisma client (`@repo/database`). See `AI_ENGINEER.md` for the known Prisma/Bun CLI quirks before running any `prisma` command in here.
- `packages/ui` — Shared React component library (`@repo/ui`), consumed via `@repo/ui/<name>` importing directly from `src/<name>.tsx` (no build step — see `exports` map in `packages/ui/package.json`). Only used by `web` and `docs`, not `admin`.
- `packages/eslint-config` — Shared ESLint flat configs (`base.js`, `next.js`, `react-internal.js`).
- `packages/typescript-config` — Shared `tsconfig.json` bases (`base.json`, `nextjs.json`, `react-library.json`).

Note the port overlap: `apps/docs` and `apps/api` both default to port 3001 — don't run them simultaneously without changing one.

## Commands

Package manager is **bun** (see `devEngines` in root `package.json`; bun v1.3.14). Task running is via **Turborepo**.

Root-level (runs across all workspaces via turbo):
```sh
bun run build         # turbo run build
bun run dev            # turbo run dev
bun run lint            # turbo run lint
bun run check-types   # turbo run check-types
bun run format          # prettier --write "**/*.{ts,tsx,md}"
```

Scope any of the above to a single workspace with `--filter`:
```sh
turbo run dev --filter=admin
turbo run build --filter=web
turbo run lint --filter=docs
```

`apps/api` is not wired into the root `turbo.json` task graph in the same way as the Next.js apps (no `build`/`check-types` script); run it directly:
```sh
cd apps/api
bun install
bun run dev     # bun run --watch index.ts
bun run start   # bun run index.ts
```

There is no test runner configured anywhere in the repo yet (no test script in any `package.json`).

## Architecture notes

- This started from `create-turbo` (see root `README.md`) — `apps/web`, `apps/docs`, and `packages/*` are still close to stock scaffold content. Treat their structure as a reference/template rather than product code.
- `apps/admin` and `apps/api` are the two workspaces with actual restaurant-platform-specific code and were added after the initial scaffold (they're untracked in git as of this writing — check `git status` before assuming they're committed).
- `apps/admin` intentionally diverges from the shared-package pattern used by `web`/`docs`: it has its own `eslint.config.mjs`, its own `tsconfig.json`, and uses Tailwind v4 directly rather than any `@repo/*` package. Don't try to "fix" this by wiring it into `@repo/ui`/`@repo/eslint-config` unless asked.
- **`apps/admin` pins `next@16.2.12`, a version newer/different from what any training data would reflect, with breaking API/convention changes.** Before writing or editing code in `apps/admin`, read the relevant guide under `apps/admin/node_modules/next/dist/docs/` and follow any deprecation notices found there. This does not apply to `apps/web`/`apps/docs`, which are pinned to `next@16.2.0`.
