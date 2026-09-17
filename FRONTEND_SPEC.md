# Frontend Specification — Digital Restaurant Experience Platform

Design specification for the two frontend applications. Written before any frontend code existed,
to define what would be built and why; **most of it has since been built**, and the tags on each
section say which parts have and have not. §0 is the authoritative inventory.

Companion documents: [`ARCHITECTURE.md`](ARCHITECTURE.md) (system design),
[`AI_ENGINEER.md`](AI_ENGINEER.md) (conventions, environment), [`PROJECT_ROADMAP.md`](PROJECT_ROADMAP.md)
(phasing), [`apps/api/README.md`](apps/api/README.md) (the API this consumes).

## Status legend

| Tag | Meaning |
| --- | --- |
| **IMPLEMENTED** | Exists in the repository today, verified working. |
| **PLANNED** | Agreed design, no code written. |
| **FUTURE** | Expected eventually; design deliberately not settled. |

**This document was written before the frontend existed, and most of its section headings still
carry the `(PLANNED)` tag from that time.** Those designs have since been implemented in Phases 7
and 9. §0 below is the authoritative statement of what exists; where a heading's tag and §0
disagree, §0 wins. Sections **5** (restaurant theme system), **6** (controlled customization) and
**26** (future extensibility) are the substantive parts that remain genuinely unbuilt, along with
the presigned-upload flow in §18.

---

## 0. Where the frontend actually stands (IMPLEMENTED)

Honest baseline, verified against the repository rather than carried over from an earlier draft.

| Workspace | State today |
| --- | --- |
| `apps/web` | Real product UI. `/r/[slug]` renders header, banner/logo, menu, hours and open status. Tailwind v4, shares `@repo/ui`. Port 3000. **105 tests.** |
| `apps/admin` | Real product UI. Auth, restaurant selection, profile, hours editor, menu/category/item management, branding uploads. Tailwind v4, standalone ESLint/TS config. **116 tests.** |
| `packages/ui` | Real primitives — `alert`, `badge`, `button`, `card`, `input`, `label`, `skeleton`, `skip-link`, `visually-hidden`, plus `lib/{cn,money,opening-hours}` and `styles/theme.css`. The scaffold `code.tsx` and the `appName`/`alert()` demo button are gone. **83 tests.** |
| `apps/docs` | Still the leftover `create-turbo` sample. Not part of the product; slated for removal. |

**The asymmetry this document opens with has reversed.** It was written when the backend was ready
and the frontend was not; today both exist, and what remains unbuilt is listed per-section above.

### What the API provides (IMPLEMENTED)

```
Public   GET  /restaurants              active only, reduced fields, paginated
         GET  /restaurants/{slug}       by slug; 404 if missing or inactive
         GET  /restaurants/{slug}/menu  full published menu, unpaginated
         GET  /media/{key}              stored object bytes (local driver only)

Admin    GET  /admin/restaurants        caller's restaurants only     (session required)
         GET  /admin/restaurants/{id}   returns { restaurant, role }
         POST /admin/restaurants        creator becomes OWNER
         PATCH/DELETE /admin/restaurants/{id}
         GET|PUT      /admin/restaurants/{id}/hours
         GET|POST     /admin/restaurants/{id}/categories
         GET|PATCH|DELETE  .../categories/{categoryId}
         GET|POST     /admin/restaurants/{id}/menu-items
         GET|PATCH|DELETE  .../menu-items/{menuItemId}
         GET|POST     /admin/restaurants/{id}/media
         DELETE            .../media/{mediaId}

Auth     POST /api/auth/sign-up/email | sign-in/email | sign-out
         GET  /api/auth/get-session
Ops      GET  /health  /ready  /openapi.json  /docs
```

The public list payload is `id, name, slug, description, address, city, country, currency`. The
public detail payload adds `timeZone`, `status` (`open`/`closed`/`unknown`), `hours` (seven days
as minutes past local midnight), and `branding` (`logo` and `banner`, each `null` or
`{ url, width, height }`). Contact details, timestamps and `isActive` are deliberately **not**
public.

### What the frontend still needs and the backend does not have

| Need | Status | Blocks |
| --- | --- | --- |
| Restaurant theme fields | Not scheduled | Theme system (§5), controlled customization (§6) |
| Member-management API | Not scheduled | Admin "invite staff" screen |
| On-demand cache invalidation | Housekeeping | Owner edits take up to 60s to appear publicly |
| Presigned upload URLs | Deferred (Phase 7) | Direct browser→R2 uploads (§18) |
| Menu-item image fields | Deferred (Phase 7) | Dish photos (§17) |

**Note on §5 and §6.** The theme system is the largest unbuilt design in this document, and it has
no backend support at all — no theme columns exist on `Restaurant`. Everything rendered today uses
one shared design system from `@repo/ui`. Do not assume any part of §5 or §6 is available.

---

## 1. Frontend architecture (IMPLEMENTED)

Two independent Next.js App Router applications in the existing Turborepo, sharing packages but
deployed separately. **Not** one app with a role switch.

```
                        ┌────────────────────────────────────────┐
                        │          Customer's phone              │
                        │        (scans QR at the table)         │
                        └──────────────────┬─────────────────────┘
                                           │ HTTPS
                        ┌──────────────────▼─────────────────────┐
                        │  apps/web — public                     │
                        │  Server Components, ISR-cached          │
                        │  no auth, no accounts                   │
                        └──────────────────┬─────────────────────┘
                                           │ server-side fetch (no cookies)
                                           ▼
   ┌────────────────────┐     ┌────────────────────────────────┐
   │ apps/admin         │────▶│  apps/api  (Bun + Hono)        │
   │ owner/staff SPA-ish│     │  the ONLY data authority       │
   │ session required   │◀────│                                │
   └────────────────────┘     └───────────────┬────────────────┘
        browser + server                      │
        both talk to the API                  ▼
                                      ┌────────────────┐
                                      │  PostgreSQL    │
                                      └────────────────┘

   shared: @repo/ui  @repo/validation  @repo/typescript-config  @repo/eslint-config
   NEVER:  @repo/database — frontends must not reach the database
```

**Why two apps rather than one.** They differ in nearly every dimension that drives frontend
architecture: the public app is anonymous, read-only, SEO-critical, cached, and must ship minimal
JavaScript to a phone on restaurant Wi-Fi; the admin app is authenticated, write-heavy, never
indexed, and can afford a heavier bundle. Merging them would force the strictest constraint of
each onto the other and put authenticated code in the same bundle graph as public pages. It also
keeps blast radius small: an admin deploy cannot break a customer's menu.

**Hard rule — the frontends never touch PostgreSQL.** `@repo/database` is API-only. All data
crosses HTTP, so business rules, authorization, and validation live in exactly one place.

---

## 2. Public URL structure (IMPLEMENTED)

### apps/web

| Route | Purpose | Rendering |
| --- | --- | --- |
| `/` | Platform landing page | Static |
| `/r/[slug]` | **Restaurant menu — the QR destination** | ISR |
| `/r/[slug]/category/[categorySlug]` | Deep link to one section | ISR (FUTURE) |
| `/legal/privacy`, `/legal/terms` | Static | Static |
| `/not-found`, `/error` | Boundaries | — |

### Decision: `/r/[slug]`, not `/[slug]`

A root-level slug gives shorter QR URLs, and shorter URLs are genuinely better on a printed code.
It also permanently reserves the entire root namespace: every future marketing route (`/pricing`,
`/about`, `/login`) becomes a name no restaurant may ever hold, and a restaurant named "about"
becomes a live routing bug rather than a validation error.

`/r/` costs two characters and removes that whole class of failure. Slug collisions become
impossible by construction, and the platform stays free to add any route it likes.

**Migration path if the tradeoff is later judged wrong:** add root-level `/[slug]` with a
reserved-word deny-list and 301 `/r/[slug]` → `/[slug]`. Cheap in that direction; the reverse is
not.

Custom domains per restaurant (`menu.pizzapalace.com`) are **FUTURE** — see §26.

### apps/admin

| Route | Purpose |
| --- | --- |
| `/login`, `/register` | Unauthenticated |
| `/` | Restaurant picker, or redirect when the user has exactly one |
| `/restaurants/[id]` | Dashboard for one restaurant |
| `/restaurants/[id]/settings` | Profile, contact, hours (Phase 5) |
| `/restaurants/[id]/theme` | Controlled theme editor (§5–6) |
| `/restaurants/[id]/menu` | Categories and items (Phase 6) |
| `/restaurants/[id]/members` | Staff management (needs a backend API first) |

`[id]` is used in admin because the admin API is id-addressed; `[slug]` is used publicly so
internal identifiers stay out of public URLs.

---

## 3. QR → restaurant → menu flow (IMPLEMENTED)

```
1. Owner generates a QR in admin              (IMPLEMENTED)
      encodes: https://<web-host>/r/pizza-palace
2. Printed on the table
3. Customer scans → phone browser opens the URL
4. apps/web resolves the slug:
      GET /restaurants/pizza-palace
      ├─ 200 → render menu with that restaurant's theme
      └─ 404 → "This menu isn't available" (missing OR deactivated)
5. Menu renders. No login. No app install. No cookie required.
```

**Design constraints this imposes:**

- **The URL is the entire entry point.** No app, no install, no account. If the page does not
  render usefully within a couple of seconds on a mid-range phone on poor Wi-Fi, the product has
  failed at the only moment it gets.
- **The QR encodes a slug, never an id.** Slugs are human-readable, and an id in a printed code
  would leak internal identifiers permanently.
- **QR codes are printed and physically deployed — the URL is effectively immutable.** This was
  resolved in Phase 8, in favour of history and redirects rather than immutability. An owner may
  rename freely; every slug a restaurant has ever held stays reserved to it and keeps resolving,
  and `/r/[slug]` answers a retired slug with a `307` to the current URL. The reservation is a
  database guarantee, so one restaurant can never inherit another's printed codes. The redirect is
  deliberately temporary rather than permanent — a retired slug can become current again, and a
  cached permanent redirect would strand the reclaimed code.
- **Table number** (`/r/[slug]?t=12`) is **FUTURE**, relevant only if ordering is ever added.

---

## 4. Multi-restaurant rendering architecture (IMPLEMENTED)

**One deployment serves every restaurant.** There is no per-restaurant build, bundle, or
environment.

```
   /r/pizza-palace ─┐
   /r/beta-bistro  ─┼─▶ same Next.js deployment ─▶ GET /restaurants/{slug}
   /r/… (thousands) ┘      same code, same bundle       │
                                                        ▼
                                   restaurant record + theme + menu
                                                        │
                                                        ▼
                                     one generic renderer, data-driven
```

Rules that keep this true:

1. **No restaurant-specific code, ever.** No `if (slug === "pizza-palace")`, no per-restaurant
   component files, no per-restaurant config committed to the repo. A new restaurant is a database
   row and nothing else.
2. **All variation is data.** Content comes from the API; appearance comes from validated theme
   configuration (§5). A restaurant that wants a different look picks different theme values, not
   different code.
3. **Owners change their restaurant without a deployment.** Editing a name, price, or colour in
   admin is a database write; the public page reflects it after cache revalidation (§12). No
   rebuild, no release.
4. **The renderer must survive sparse data.** Most optional fields are nullable — no description,
   no address, no image. Every component states what it does when the data is absent (§13).

**Scaling shape:** because pages are cached per slug and served from a CDN, adding restaurants
adds cache entries, not load. This matches the read-heavy profile in `ARCHITECTURE.md` §10.

---

## 5. Restaurant theme system (PLANNED — not built, no backend support)

Restaurants must look meaningfully different without executing anything they supply.

### Proposed theme fields

**Requires a backend schema addition (Phase 5) — proposed here, not created.**

| Field | Type | Validation |
| --- | --- | --- |
| `themePreset` | enum | `CLASSIC \| MODERN \| MINIMAL \| BOLD` |
| `primaryColor` | string | `^#[0-9a-fA-F]{6}$` |
| `accentColor` | string | `^#[0-9a-fA-F]{6}$` |
| `fontPreset` | enum | fixed allow-list (e.g. `SANS \| SERIF \| ROUNDED \| CONDENSED`) |
| `layoutVariant` | enum | `LIST \| GRID \| CARDS` |
| `logoKey` | string? | object-storage key, not a URL (§17) |
| `heroImageKey` | string? | object-storage key |

Every field is an **enum or a pattern-validated scalar**. There is no free-form styling field, by
design.

### How a theme reaches the page

Validated values become CSS custom properties on a server-rendered wrapper. Nothing is injected
as markup or script.

```tsx
// PLANNED — illustrative shape only
<div
  data-theme-preset={theme.themePreset}      // drives preset-level rules in CSS
  data-layout={theme.layoutVariant}
  style={{
    "--brand-primary": theme.primaryColor,   // validated #RRGGBB
    "--brand-accent": theme.accentColor,
  } as React.CSSProperties}
>
  {children}
</div>
```

Tailwind utilities reference those variables, so components stay generic and the theme is the only
thing that varies. Fonts are loaded via `next/font` from the fixed preset list — never from a
URL the owner supplies.

**Server-rendered, in the initial HTML.** The theme must not be applied by client JavaScript after
paint: that guarantees a flash of unstyled or wrong-branded content on exactly the slow connection
the product is designed for.

---

## 6. Controlled customization model (PLANNED — depends on §5)

The single most important security boundary in the frontend.

### Absolute prohibitions

| Never allowed | Why |
| --- | --- |
| Owner-supplied HTML | Stored XSS against every customer who scans that table's code |
| Owner-supplied CSS | Exfiltration and UI-redress attacks; trivially breaks accessibility |
| Owner-supplied JavaScript | Full compromise of the page |
| `dangerouslySetInnerHTML` on any owner content | The delivery mechanism for all of the above |
| Owner-supplied font/script/style URLs | Arbitrary third-party code execution and tracking |

**This holds even for "trusted" owners.** A compromised owner account would otherwise become a
compromise of every customer of that restaurant.

### What owners *can* control

Colours (validated hex), a font preset, a layout variant, a theme preset, their logo and images
(uploaded through a validated pipeline, §17), and all of their own text content.

### Text content handling

Names, descriptions, and prices are **rendered as text**, never as markup — React escapes by
default, and that default must not be overridden. If rich text is ever genuinely needed, the only
acceptable route is a strict allow-list Markdown renderer with HTML disabled (**FUTURE**, requires
its own review).

### Validation happens twice

1. **On write** — the API validates against the Zod schemas in `@repo/validation` before
   persisting.
2. **On render** — `apps/web` re-validates theme values before applying them, and falls back to
   platform defaults on anything unexpected.

Step 2 is not redundant. It means a value that reached the database another way (a migration, a
direct SQL fix, a future bug) still cannot reach a customer's browser as an unvalidated style.

### Accessibility is part of validation

Contrast between `primaryColor` and the text rendered on it must meet **WCAG 2.2 AA (4.5:1)**.
Checked in admin at edit time with a live preview and a clear warning, and enforced server-side on
save. An owner must not be able to configure a menu that their customers cannot read — this is a
correctness rule, not a preference.

---

## 7. Mobile-first design principles (IMPLEMENTED)

Mandatory, and for the public app it is the *only* case that truly matters: the customer is
standing at a table, on a phone, possibly on congested Wi-Fi, often in dim light.

- **Design at 360×640 first**, then scale up. Breakpoints add, never rescue.
- **Touch targets ≥ 44×44 px**, with real spacing between them.
- **Type ≥ 16px** for body text — also prevents iOS zoom-on-focus.
- **Thumb reach**: primary actions in the lower two-thirds.
- **Contrast beyond the minimum** where practical; dim restaurants are the environment.
- **No hover-only affordances.** Hover does not exist on the primary device.
- **Respect `prefers-reduced-motion`** and `prefers-color-scheme`.
- **Assume a slow network**: the menu must be readable before any image finishes loading.

Admin is mobile-*aware* rather than mobile-first — owners realistically use a laptop for menu
editing — but must remain usable on a tablet, and quick actions (toggle an item's availability)
must work on a phone from the floor of the restaurant.

---

## 8. Component architecture (IMPLEMENTED)

Three tiers, distinguished by what they know about:

```
Primitives (@repo/ui)          Button, Input, Card, Badge, Skeleton, Dialog
  └─ know nothing about restaurants; pure presentation

Domain components (per app)    MenuItemCard, CategorySection, RestaurantHeader
  └─ know the domain shape; still no data fetching

Route compositions (app/)      page.tsx / layout.tsx
  └─ fetch data, compose the above, own loading & error boundaries
```

Rules:

- **Data fetching lives in route-level Server Components**, not inside domain components. A
  component that fetches its own data cannot be reused, previewed, or tested in isolation.
- **Props down.** Domain components receive plain data and render it.
- **Every domain component defines its empty state** — the data model is mostly nullable.
- **Themeable by CSS variables**, never by a `restaurantId` prop. A component must never branch on
  which restaurant it is rendering.

---

## 9. Next.js App Router strategy (IMPLEMENTED)

> **Version note (IMPLEMENTED constraint):** `apps/admin` pins `next@16.2.12`, `apps/web` pins
> `next@16.2.0` — both newer than most training data, with breaking convention changes. Per
> `AI_ENGINEER.md`, **read the relevant guide under `node_modules/next/dist/docs/` before writing
> App Router code.** Do not assume older App Router idioms still apply.

| Convention | Use |
| --- | --- |
| `layout.tsx` | Shared shell. In `/r/[slug]`, this is where the theme wrapper belongs. |
| `page.tsx` | Route content; Server Component by default. |
| `loading.tsx` | Streaming skeleton — matches final layout to avoid layout shift. |
| `error.tsx` | Recoverable errors, with retry. Client Component by necessity. |
| `not-found.tsx` | Unknown or inactive restaurant. |
| `generateMetadata` | Per-restaurant title/description/OG (§15). |
| Route Handlers | Only where a server endpoint is genuinely needed (revalidation hook, health). |
| Server Actions | Admin mutations (§11). |

**`generateStaticParams` is deliberately not used for restaurants.** Pre-rendering every
restaurant at build time makes build duration grow with customer count and forces a deploy to
publish a new restaurant — directly contradicting §4. Dynamic rendering with ISR gives the same
delivered performance without coupling build time to tenant count.

---

## 10. Server vs Client Components (IMPLEMENTED)

**Server by default. `"use client"` is an exception that needs a reason.**

| Server Component | Client Component |
| --- | --- |
| Menu page, category sections, item cards | Menu search/filter input |
| Restaurant header, theme wrapper | Accordion / expandable sections |
| Admin data tables | All admin forms |
| Metadata, JSON-LD | Auth state, sign-out control |
| Anything reading cookies or calling the API with a session | Anything using `useState`/`useEffect`/handlers |

Why this matters here specifically: every kilobyte of client JavaScript is paid for by a customer
on a phone who wants to read a menu. A public menu page should approach **zero client JavaScript**
in its base state.

**Never in a Client Component:** session tokens, the internal API base URL, or any secret. Client
components receive already-fetched, already-authorized data as props.

**A note on `packages/ui`:** the current stub `Button` is marked `"use client"` and calls
`alert()`. Shared primitives should be server-compatible wherever possible; only genuinely
interactive primitives carry `"use client"`, so a Server Component page is not forced into the
client boundary by importing a button.

---

## 11. API integration (IMPLEMENTED)

The API is the only data source. Two distinct integration paths, because the two apps have
genuinely different requirements.

### apps/web — public, server-side only

```
Server Component ──fetch──▶ GET /restaurants/{slug}
```

- Runs on the server. **No CORS, no cookies, no credentials involved.**
- The API base URL can be an internal address in production; the browser never learns it.
- The browser makes **no API calls at all** for the base menu experience.

### apps/admin — authenticated

Two sub-paths, deliberately:

```
Auth flows      browser ──▶ POST /api/auth/sign-in/email      (Better Auth client)
                             credentials: "include"

Data flows      Server Component / Server Action
                  └─ reads session cookie via next/headers cookies()
                  └─ forwards it as a Cookie header ──▶ /admin/restaurants
```

Auth goes browser-to-API directly because Better Auth manages the cookie lifecycle and CSRF origin
checks itself (already verified working: cross-origin sign-in is rejected with
`403 INVALID_ORIGIN`). Data goes server-side so the session cookie is never handled by application
JavaScript and pages arrive already-populated.

### Deployment constraint this creates (PLANNED — important)

Better Auth sets a host-scoped session cookie on the **API's** origin.

- **Development:** cookies ignore ports, so a cookie set by `localhost:3001` is sent to
  `localhost:3002`. Works with no extra configuration.
- **Production:** `api.example.com` will **not** send its cookie to `admin.example.com` unless the
  cookie is scoped to the shared parent domain.

**Therefore: the admin app and the API must share a registrable domain**, with Better Auth's
cross-subdomain cookie option enabled and `Domain=.example.com`. Hosting them on unrelated domains
would force `SameSite=None`, which is materially weaker. This is a deployment decision that must be
made before the admin app ships.

### Contract typing

Request and response shapes come from `@repo/validation` — the same schemas the API validates
with — so the client cannot drift from the server. A generated client from `/openapi.json` is
**FUTURE**; it is not worth the tooling until the endpoint surface grows.

---

## 12. Data fetching and caching (IMPLEMENTED)

Menus change rarely and are read constantly. Caching is the highest-leverage performance decision
in the product (`ARCHITECTURE.md` §10, step 2).

| Data | Strategy | Rationale |
| --- | --- | --- |
| Public restaurant + menu | **ISR**, revalidate ~60s, tagged `restaurant:{slug}` | Most requests never reach the API |
| Platform landing | Static | Never changes per request |
| Admin lists/detail | `no-store` | Owners must see their own writes immediately |
| Auth session | Never cached | Correctness |

### Revalidation

**Phase 1 (PLANNED, no backend change):** time-based revalidation. An owner's edit appears within
the revalidation window. Simple, and adequate for menu content.

**Phase 2 (PLANNED, requires a small backend addition):** on-demand revalidation. `apps/web`
exposes a Route Handler protected by a shared secret; the API calls it after a mutation, and the
handler calls `revalidateTag(\`restaurant:${slug}\`)`. Edits then appear within seconds.

> Phase 2 **adds an outbound webhook to the backend**. That is a backend change and is therefore
> out of scope for this document — it requires explicit approval before implementation. Phase 1
> requires nothing from the backend and should ship first.

**Stale data is acceptable here.** A price that is 60 seconds out of date is a normal menu; a menu
that is slow or unavailable is a failed product.

---

## 13. Loading, error, and empty states (IMPLEMENTED)

Every data-driven view specifies all four states. The API's fields are mostly nullable, so empty
is the common case, not the edge case.

| State | Public (`apps/web`) | Admin |
| --- | --- | --- |
| **Loading** | `loading.tsx` skeleton matching final layout (no layout shift) | Skeleton rows; disabled, spinner-labelled submit buttons |
| **Empty** | "This restaurant hasn't published its menu yet" — never a blank page | Actionable empty state: "Add your first category" |
| **Error** | Friendly message + retry; never a stack trace or status code | Same, plus the `requestId` for support |
| **Not found** | Unknown *or deactivated* restaurant → one shared message | 403 → "You don't have access to this restaurant" |

Specific behaviours:

- **`GET /restaurants/{slug}` returns 404 for both "no such restaurant" and "deactivated".** The
  frontend must not attempt to distinguish them — that indistinguishability is a deliberate backend
  property (§21) and the UI copy must respect it.
- **Admin `403` and "does not exist" are also identical by design.** Copy must not imply the
  restaurant exists.
- **Surface `requestId`** in admin error states. Every API error carries one, and it correlates
  directly to server logs.
- **Partial failure**: if the restaurant loads but the menu does not, render the restaurant and an
  inline menu error rather than failing the whole page.

---

## 14. Accessibility (IMPLEMENTED)

Target: **WCAG 2.2 AA**. For a public menu this is close to a functional requirement — a menu that
cannot be read is not a menu.

- **Semantic HTML first**: real headings in order, `<ul>` for item lists, `<main>`/`<nav>`/
  `<header>` landmarks, ARIA only where semantics genuinely run out.
- **Prices must be announced sensibly** by screen readers — a visual-only currency glyph is not
  enough.
- **Dietary/allergen indicators must never be colour-only.** Icon plus text label. This is a safety
  issue, not a styling one.
- **Keyboard**: full operability, visible focus rings (never `outline: none` without a replacement),
  logical order, skip-to-content link.
- **Contrast enforced by the theme system** (§6) so an owner cannot configure an unreadable menu.
- **Images** carry meaningful `alt`; decorative images use `alt=""`.
- **Forms** (admin) use real `<label>`s, `aria-describedby` for errors, and never rely on
  placeholder-as-label.
- **Respect `prefers-reduced-motion`.**

Verified by automated axe checks in CI plus manual keyboard and screen-reader passes on the menu
page (§25).

---

## 15. SEO (IMPLEMENTED)

Applies to `apps/web` only. **`apps/admin` must be `noindex, nofollow` everywhere.**

- **`generateMetadata` per restaurant**: title, description, canonical, OpenGraph, Twitter card.
- **JSON-LD structured data**: `Restaurant` plus `Menu`/`hasMenu` from schema.org, emitted
  server-side. This is what makes a menu eligible for rich results.
- **`sitemap.ts`** generated from the public restaurant list; **`robots.ts`** allowing public
  routes and disallowing everything else.
- **Server-rendered content.** A menu rendered only by client JavaScript is a menu search engines
  and link previews cannot read.
- **Canonical URLs** — one restaurant, one indexable URL. If root-level slugs are added later
  (§2), the redirect must preserve canonicalisation.

OG images generated per restaurant are **FUTURE** (depends on media, §17).

---

## 16. Performance (IMPLEMENTED)

Budgets for the public menu page on a mid-range phone over 4G:

| Metric | Budget |
| --- | --- |
| LCP | < 2.5 s |
| CLS | < 0.1 |
| INP | < 200 ms |
| Client JS (base menu page) | < 50 KB gzipped |
| Time to readable menu text | < 1.5 s |

How they are met:

- **Server rendering + ISR + CDN** — most requests never touch the API or database (§12).
- **Near-zero client JavaScript** on the base menu page (§10).
- **`next/font`** with subsetting and `display: swap`; fonts self-hosted from the preset list, never
  fetched from a third party.
- **Explicit image dimensions** to reserve space and protect CLS.
- **Text before images**: the menu must be readable before any photo loads.
- **Skeletons that match final geometry**, so streaming does not cause shift.

Admin budgets are looser but tables must remain responsive at realistic menu sizes (hundreds of
items) — virtualise only if measurement shows it is needed.

---

## 17. Image and media strategy (IMPLEMENTED for branding; menu-item images deferred)

**Restaurant branding is built.** `apps/web` renders a banner and a logo on `/r/[slug]` when they
exist. Both are optional, and the page is designed to be correct with neither — a fully-supported
normal state, not a degraded fallback. **Menu-item images do not exist** and no column holds them.

What was implemented, against each principle this section set out:

- **Object keys in the database, never absolute URLs.** Held as written: `RestaurantMedia` stores
  a provider-neutral `storageKey`, and the API composes `key → URL` from configuration at
  response time. The frontend receives a resolved URL and never sees the key.
- **`next/image`** for responsive sizes, modern formats and lazy loading. The banner is the LCP
  element and carries `priority`; the logo does not.
- **`images.remotePatterns` restricted to the exact media host.** `apps/web/next.config.js`
  derives a single pattern from `MEDIA_PUBLIC_BASE_URL` and pins protocol, hostname, port, path
  prefix *and* an empty query string. A foreign host and a non-media path on the allowed host are
  both rejected. `apps/admin` needs no such configuration: its previews are plain `<img>`, since
  the page is private, never indexed, and viewed once while editing.
- **One non-obvious configuration consequence.** Next 16's optimiser resolves each upstream host
  and refuses loopback addresses as SSRF protection — which blocks the local driver, whose media
  host *is* `localhost`. It fails with the same `"url" parameter is not allowed` message as a
  pattern mismatch, so diagnose by the server log (`resolved to private ip`) rather than by the
  response. `dangerouslyAllowLocalIP` is therefore enabled **only when the configured media host
  is itself loopback**; with R2 in production it stays off, and the allow-list applies regardless.
- **Dimensions always reserved.** The API returns intrinsic `width`/`height` for every image, and
  the banner container sets `aspect-ratio` from them, so nothing shifts on load.
- **Meaningful `alt`.** The logo is `"<restaurant name> logo"`; the banner is `alt=""`, because it
  is decorative — the name it would otherwise announce is stated immediately below it.

Still true of the *upload* path: client-side checks are UX only. The API re-reads the bytes and is
the authority — see §18.

---

## 18. Cloudflare R2 integration (PARTIAL — adapter built, never run against a live bucket; presigned uploads deferred)

**What was actually built differs from the diagram below, deliberately.** Bytes pass through the
API — browser → Server Action → API → storage — because presigned URLs cannot work for a local
filesystem, and shipping them first would have left development with no working upload path at
all. The diagram therefore describes the *intended eventual* flow, not today's.

Today: uploads are `multipart/form-data` to `POST /admin/restaurants/{id}/media`, capped by
`MEDIA_MAX_BYTES` (5 MB by default) through a per-path body limit. The browser never holds R2
credentials — it never contacts storage at all — and `STORAGE_DRIVER` is not exposed to it.
**R2 itself has never run against a live bucket**, so nothing here should be described as
verified in production.

```
Admin browser                    apps/api                     Cloudflare R2
     │  1. request upload URL         │                              │
     ├───────────────────────────────▶│  validates type/size, authz  │
     │  2. presigned PUT URL          │                              │
     │◀───────────────────────────────┤                              │
     │  3. PUT file directly ─────────┼─────────────────────────────▶│
     │  4. confirm; persist key       │                              │
     ├───────────────────────────────▶│                              │
                                                                     │
apps/web  ◀── public CDN URL composed from stored key ───────────────┘
```

- **Image bytes never pass through the API** — that is what keeps the API stateless and
  horizontally scalable (`ARCHITECTURE.md` §10).
- **The frontend never holds R2 credentials.** It receives a short-lived presigned URL per upload.
- Client-side validation (type, size, dimensions) is **UX only**; the API re-validates. Never trust
  a client-side file check.
- Admin shows real upload progress and handles failure mid-upload — mobile uploads fail often.

---

## 19. Authentication integration with Better Auth (IMPLEMENTED)

Better Auth is **IMPLEMENTED** on the backend at `/api/auth/*`. The frontend integrates with it; it
does not reimplement any of it.

- Use the **`better-auth/react`** client (the installed package ships `./client` and `./react`
  entrypoints — IMPLEMENTED fact) pointed at the API base URL, configured with
  `credentials: "include"`.
- **Never** store tokens in `localStorage` or `sessionStorage`. The session is an `httpOnly`
  cookie the frontend cannot and must not read — that is what makes an XSS bug non-fatal.
- **Never** implement password hashing, session creation, or token refresh in the frontend.
- Requests that change auth state must be sent with a correct `Origin`; Better Auth enforces this
  and rejects cross-origin attempts with `403 INVALID_ORIGIN` (verified).
- `Content-Type: application/json` and a JSON body are required even where the body is empty —
  sign-out needs `{}`. (Verified: omitting these returns 415/400, which reads like a bug and is
  not one.)

### Flows

| Flow | Behaviour |
| --- | --- |
| Register | Password ≥ 12 chars, enforced client-side for UX and server-side for real |
| Login | On success, redirect to the originally requested route |
| Session | Resolved **server-side** in a layout; pages receive it as data |
| Logout | Server-side invalidation, then redirect to `/login` |
| Expiry | A `401` from any data call redirects to `/login`, preserving the return path |

**No email verification or password reset flows** — the backend has no transactional email. The UI
must not present a "Forgot password?" link that cannot work. Recorded as a known gap.

---

## 20. Admin authorization (IMPLEMENTED)

**The backend is the authority. Frontend checks are UX, never enforcement.**

The API already enforces membership scoping and role capabilities, verified by audit:
`GET /admin/restaurants` returns only the caller's restaurants; a non-member receives `403` on
read, update, and delete.

| Capability | OWNER | STAFF |
| --- | --- | --- |
| `restaurant:read` | ✅ | ✅ |
| `restaurant:update` | ✅ | ✅ |
| `restaurant:delete` | ✅ | ❌ |
| `member:manage` | ✅ | ❌ |

Frontend responsibilities:

- **Hide what the user cannot do** — a STAFF member should not see a Delete button that will only
  produce a 403. Better UX, not security.
- **Handle 403 gracefully anyway.** The UI can be stale, permissions can change mid-session, and a
  user can craft a request by hand. A 403 must always render a clean message.
- **Never send a role from the client to decide access.** Mass-assignment protection was verified
  server-side; the frontend must not build flows that assume otherwise.
- **Middleware guards routes** for redirect-to-login only. Route protection is not access control.

**Members management UI is blocked** — no backend endpoints exist for inviting staff or changing
roles, so a restaurant cannot currently add a second user through any interface.

---

## 21. Security (IMPLEMENTED)

Frontend-specific obligations, on top of the verified backend posture.

| Concern | Rule |
| --- | --- |
| **XSS** | No `dangerouslySetInnerHTML` on owner or user content. React's escaping is the default and must stay the default. |
| **Owner customization** | Enums and validated scalars only (§6). No CSS, HTML, JS, or external URLs. |
| **Secrets** | Nothing sensitive in `NEXT_PUBLIC_*`. Anything so prefixed is public — treat it as printed on the page. |
| **Session** | `httpOnly` cookie only; never mirrored into JS-readable storage. |
| **CSP** | **PLANNED** — a strict policy on `apps/web`. Feasible precisely because owners cannot inject styles or scripts. |
| **Image optimiser** | `remotePatterns` restricted to the media host; never a wildcard. |
| **Error output** | Never render raw API error internals; show a friendly message plus `requestId`. |
| **Admin indexing** | `noindex, nofollow` on every admin route. |
| **Dependencies** | Any new frontend dependency must be justified; keep the public bundle small and the supply-chain surface narrow. |

---

## 22. Responsive design (IMPLEMENTED)

Mobile-first breakpoints, additive only:

| Range | Target | Menu layout |
| --- | --- | --- |
| < 640px | Phone (**primary**) | Single column |
| 640–1024px | Tablet | Two columns where `layoutVariant` allows |
| > 1024px | Desktop | Constrained max-width; never full-bleed text |

- **Fluid by default**: relative units, `clamp()` for type, flex/grid.
- **No horizontal scrolling at any width** — wide content (long descriptions, admin tables) scrolls
  within its own container.
- **`layoutVariant`** (§5) selects among *pre-built responsive layouts*; it never lets an owner
  define arbitrary geometry.
- Admin tables collapse to card lists on narrow screens rather than scrolling horizontally.

---

## 23. State management strategy (IMPLEMENTED)

**No global state library.** Not initially, and possibly never.

| Kind of state | Where it lives |
| --- | --- |
| Server data | Server Components + the framework cache |
| Filters, selected category, pagination | **The URL** (`searchParams`) |
| Form state | `useActionState` with Server Actions |
| Ephemeral UI (open/closed) | Local `useState` |
| Session | Server-resolved, passed down |
| Optimistic updates | `useOptimistic` |

Rationale: most "global state" in a data-driven app is server state with extra steps. Server
Components remove that need, and putting filters in the URL makes views shareable, linkable, and
restorable for free — which matters when a customer wants to send someone a link to a section.

**If** a genuine need appears — heavy client-side cross-view caching, or complex multi-step admin
wizards — TanStack Query (server cache) or Zustand (client-only UI state) may be introduced, with a
written justification. Introducing either preemptively is the mistake this section exists to
prevent.

---

## 24. UI package strategy (RESOLVED — shadcn/ui deliberately not installed)

**The decision this section asked for has been made and acted on.** What follows records both the
outcome and the reasoning, so it is not reopened by accident.

### What exists now (IMPLEMENTED)

- **Tailwind v4 in both apps**, sharing design tokens from `@repo/ui/styles/theme.css`.
  `apps/web` no longer uses CSS Modules.
- **`@repo/ui` is the shared primitive layer**: `alert`, `badge`, `button`, `card`, `input`,
  `label`, `skeleton`, `skip-link`, `visually-hidden`, plus `lib/{cn,money,opening-hours}`.
  Built on shadcn's *conventions* — cva variants, a `cn` helper, token-driven colours — without
  installing shadcn/ui itself.
- **The scaffold components are gone.** `code.tsx` is deleted and the `appName`/`alert()` demo
  button is replaced.
- **`apps/admin` does consume `@repo/ui`** for primitives, while keeping its own ESLint and
  TypeScript configuration. That divergence was the part worth preserving; refusing shared
  primitives was not.
- **Domain components stayed in their app**, as proposed: `menu/*` in `apps/web`, `media/*` and
  `menu/*` in `apps/admin`. `@repo/ui` holds no data fetching and no domain knowledge.

### Why shadcn/ui is still not installed

Its conventions are followed and its primitives are written directly in `@repo/ui`. Every
primitive needed so far is small enough that copying in a generator's output would have added a
dependency and a code-generation step without removing any work. **Revisit only for a genuinely
complex primitive** — a combobox or a dialog with focus management — where the accessibility
detail is the hard part and worth borrowing. Do not install it for a button.
---

## 25. Testing strategy (IMPLEMENTED)

**No frontend test tooling exists.** The backend's 98 tests cover the API; the frontend has none.

| Layer | Tool | Covers |
| --- | --- | --- |
| Component | Vitest + React Testing Library | Domain components incl. empty/error states |
| Contract | `@repo/validation` schemas | API responses match expected shapes |
| E2E | Playwright | QR→menu journey, auth, admin CRUD |
| Accessibility | `axe` in Playwright | WCAG violations on key pages |
| Visual | Playwright screenshots | Theme presets render correctly |

Priority journeys, in order:

1. **Scan → menu renders** (the product's core moment)
2. Unknown/inactive slug → clean not-found
3. Menu renders with all optional fields absent
4. Login → restaurant list → edit → change appears publicly
5. STAFF cannot see or invoke owner-only actions
6. Theme presets render legibly, contrast enforced

Principles: test behaviour, not implementation; no snapshot tests of entire pages (they break on
every copy change and assert nothing meaningful); mock at the **network** boundary so the real
fetch/serialisation path is exercised. Coverage percentage is not a goal.

---

## 26. Future extensibility (FUTURE)

Designed for, not built:

| Capability | Notes |
| --- | --- |
| Custom domains | `menu.pizzapalace.com` → host-based slug resolution via middleware. `/r/[slug]` remains canonical. |
| Internationalisation | Menus in multiple languages. Affects the data model — plan before content grows. |
| Online ordering | Would introduce cart state and payments — the first genuine case for a client state library. |
| PWA / offline menu | Attractive on poor restaurant Wi-Fi. |
| Table-aware experience | `?t=12` context. |
| Analytics | Scan counts, popular items. Must be privacy-respecting; no third-party scripts on the public page without review. |
| Menu scheduling | Breakfast/lunch/dinner by time of day. |
| Generated OG images | Per-restaurant social previews. |

### What can be built before Phase 6 (the menu models) lands

Since the menu has no data source yet, the buildable slice is:

1. Tailwind + `@repo/ui` foundation (pending §24 approval)
2. Admin authentication (login, register, session, logout) — the API fully supports this today
3. Admin restaurant list, create, and edit — fully supported today
4. Public restaurant page rendering **name, description, address, city, country** — everything the
   public API returns today — with the menu section as an explicit "coming soon" empty state
5. Theme system scaffolding, pending the Phase 5 schema fields

That sequence delivers real, working software against endpoints that already exist, and leaves a
menu-shaped hole ready to fill.
