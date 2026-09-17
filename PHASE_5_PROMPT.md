# PHASE 5 — RESTAURANT PROFILE, OPERATING HOURS & TIMEZONE

You are the implementation agent for the restaurant-platform monorepo.

Your job is to fully implement Phase 5 in the existing repository.

DO NOT start Phase 6, Phase 7, QR, media uploads, analytics, or any other future feature.

The goal is to implement this phase completely, safely, and production-quality, while preserving the existing architecture and contracts.

---

# 1. SOURCE OF TRUTH

Before changing anything, read these files completely:

- AI_ENGINEER.md
- ARCHITECTURE.md
- PROJECT_ROADMAP.md

Also read these if they exist:

- DATABASE_SPEC.md
- BACKEND_SPEC.md
- FRONTEND_SPEC.md

Then inspect the actual repository.

Do not assume that the documentation is perfectly synchronized with the code.

The existing implementation is the final authority for:
- existing APIs
- existing database models
- existing authorization
- existing response shapes
- existing frontend architecture
- existing testing conventions

If documentation and implementation disagree, identify the discrepancy before making a design decision.

---

# 2. CURRENT ARCHITECTURE — DO NOT BREAK IT

The project is a Turborepo + Bun modular monolith.

Current structure:

apps/
  api/       Bun + Hono
  web/       Next.js public restaurant application
  admin/     Next.js management console

packages/
  database/          Prisma
  validation/        Zod schemas
  ui/                shared UI primitives
  typescript-config/
  eslint-config/

Backend modules use:

routes
  ↓
controller
  ↓
service
  ↓
repository

Existing restaurant/menu modules must remain modular.

Do NOT introduce a new architecture.

Do NOT convert the backend into microservices.

Do NOT create unnecessary abstractions.

Do NOT create a new "hours service" module unless the existing architecture genuinely requires it.

The existing Restaurant module owns restaurant profile functionality.

---

# 3. CURRENT DOMAIN

Existing domain:

Restaurant
  ├── Category
  │     └── MenuItem
  └── RestaurantMembership
        └── User

Restaurant already contains restaurant-level configuration such as:

- name
- slug
- description
- address
- city
- country
- phone/email where applicable
- currency
- timestamps
- active state

Do not duplicate Restaurant.

Do not create another restaurant/profile model.

---

# 4. PHASE 5 GOAL

Implement:

## Restaurant Profile

including:

1. Operating hours
2. Restaurant timezone
3. Public operating-hours display
4. Server-side "Open now / Closed" calculation
5. Admin hours editor
6. Appropriate validation
7. Complete tests
8. API/OpenAPI updates
9. Documentation updates where appropriate

The implementation must work correctly across:

- normal hours
- closed days
- overnight hours
- timezone boundaries
- DST transitions

---

# 5. DATABASE DESIGN

Add an OperatingHours model.

The intended conceptual relationship is:

Restaurant
   │
   └──< OperatingHours

Each restaurant has one hours record per day of the week.

Use a uniqueness constraint equivalent to:

restaurantId + dayOfWeek

The model should contain enough information to represent:

- restaurant
- day of week
- whether the restaurant is closed
- opening minute
- closing minute

Use INTEGER minute-of-day values.

Do NOT use database TIME columns for the operating-hour arithmetic.

For example:

00:00 → 0
01:00 → 60
12:30 → 750
23:59 → 1439

---

# 6. OVERNIGHT HOURS

Overnight hours must be represented explicitly.

Example:

Monday:

22:00 → 02:00

means:

Monday 22:00
through Tuesday 02:00

Do NOT create a second fake day.

Do NOT silently convert it to:

22:00 → 23:59
00:00 → 02:00

The domain representation should preserve the fact that this is one overnight operating period.

The application must correctly determine whether the restaurant is open during the overnight portion.

Examples:

Monday:
22:00–02:00

At Monday 23:00:
OPEN

At Tuesday 01:00:
OPEN

At Tuesday 03:00:
CLOSED

Design this carefully.

---

# 7. CLOSED DAYS

A restaurant must be able to explicitly mark a day as closed.

Do not require fake values such as:

openMinute = 0
closeMinute = 0

unless the domain representation explicitly makes that safe.

Prefer a clear closed representation.

The API must distinguish:

- closed
- open all day / if supported
- normal operating hours
- overnight hours

Do not add "24 hours" functionality unless the existing specification requires it.

If it is not required, do not invent it.

---

# 8. TIMEZONE

Add a timezone field to Restaurant.

Use an IANA timezone identifier.

Examples:

Asia/Kolkata
Europe/Amsterdam
America/New_York

Do NOT store arbitrary UTC offsets such as:

+05:30

because offsets do not correctly model DST.

The timezone must be validated.

Use the project's existing validation conventions.

A restaurant's timezone belongs to the Restaurant because operating hours are meaningless without knowing the restaurant's local timezone.

---

# 9. DEFAULT TIMEZONE

There must be a deliberate default.

Inspect the existing project/specification before choosing it.

Do NOT silently assume UTC merely because it is convenient.

Do NOT invent a product requirement.

If the specification does not define the default, document the design decision clearly and use the least surprising project-consistent default.

Also make sure existing restaurants created before this migration remain valid.

---

# 10. MIGRATION

Create a proper Prisma migration.

Follow the project's existing migration conventions.

IMPORTANT:

This environment previously had Prisma CLI/generate race problems.

The current documented workaround/process must be followed.

Do NOT blindly trust:

"command exited with code 0"

Verify the actual database state.

The migration must be:

- generated
- reviewed
- applied
- verified against PostgreSQL
- reflected in Prisma schema
- reflected in generated Prisma Client

Verify with direct PostgreSQL inspection where appropriate.

Do not destroy existing Restaurant, Category, MenuItem, or membership data.

---

# 11. PRISMA GENERATE

The project has a known Prisma generate race/corruption problem.

Follow the existing documented procedure in:

AI_ENGINEER.md
and/or
apps/api/README.md

Do not assume a successful exit code means the client is complete.

Verify generated output as already established by the project.

Do not overwrite a valid generated client with a corrupted partial output.

---

# 12. API DESIGN

Extend the existing Restaurant module.

Do NOT create a separate "hours" module.

Use the existing architecture:

restaurants/
  restaurant.routes.ts
  restaurant.controller.ts
  restaurant.service.ts
  restaurant.repository.ts

Add hours handling in the appropriate existing Restaurant layer.

Use the established routes/controller/service/repository pattern.

---

# 13. ADMIN API

Operating hours should be managed through:

/admin/restaurants/:restaurantId/hours

Use the existing authenticated admin architecture.

Authorization must follow the existing membership capability model.

Do NOT invent a new authorization mechanism.

The restaurantId comes from the URL/path.

Never trust restaurantId from request body.

Use the existing:

requireAuth
membershipService.authorize(...)
validation
error handling
response helpers

patterns.

---

# 14. PUBLIC API

The public restaurant response must expose operating hours.

Inspect the existing public Restaurant response first.

Extend it without breaking existing fields.

The public API must not expose private/admin-only fields.

Operating hours should be returned in a clean domain representation suitable for the public web application.

Do not expose:

- membership data
- user IDs
- private contact information unless already explicitly public
- internal authorization information
- database implementation details

---

# 15. OPEN NOW / CLOSED

The public restaurant page needs:

OPEN NOW
or
CLOSED

This calculation MUST happen server-side.

It must use:

1. the restaurant's IANA timezone
2. the restaurant's configured operating hours
3. an explicit instant supplied to the calculation

Do NOT use the browser's timezone.

Do NOT use the visitor's local timezone.

Do NOT use:

new Date()

inside deterministic domain tests.

---

# 16. TIME CALCULATION DESIGN

Separate the pure calculation from HTTP and UI.

Create a small deterministic function that accepts something equivalent to:

- operating hours
- restaurant timezone
- instant

and returns an explicit result such as:

OPEN
CLOSED

Optionally include useful metadata such as:

- today's period
- next opening time
- closing time

only if the existing product specification requires it.

Keep the core calculation pure and testable.

Do not hide timezone arithmetic inside React components.

---

# 17. TIMEZONE CONVERSION

The calculation must determine the restaurant's local date/time from an instant.

Example:

Restaurant timezone:

Asia/Kolkata

Instant:

some UTC timestamp

Convert that instant into India local time before comparing against minute-of-day hours.

Likewise:

Restaurant timezone:

America/New_York

must correctly handle DST.

Do not implement timezone conversion manually using fixed offsets.

Use a reliable existing runtime/API/library already available in the project.

Do not add a dependency unless there is a real need and the existing runtime cannot safely solve it.

If a dependency is genuinely necessary, explain why before adding it.

---

# 18. DST

Tests must explicitly cover DST.

At minimum test:

- a normal date before DST
- a date during DST
- a date after DST
- a timezone where DST exists
- a timezone without DST

Do not assume every timezone behaves like UTC or India.

The important rule:

Operating hours are expressed in the restaurant's LOCAL wall-clock time.

The instant being evaluated is an absolute point in time.

---

# 19. OVERNIGHT CALCULATION

This is a critical area.

Suppose:

Monday:
22:00–02:00

Tuesday:
10:00–18:00

At:

Monday 23:00
→ OPEN because Monday period has started

Tuesday 01:00
→ OPEN because Monday's overnight period continues

Tuesday 09:00
→ CLOSED

Tuesday 12:00
→ OPEN

The algorithm must look at the previous day's overnight period when evaluating early-morning times.

Write dedicated tests for this.

---

# 20. BOUNDARY CONDITIONS

Explicitly test:

opening minute
one minute before opening
one minute after opening

closing minute
one minute before closing
one minute after closing

For example:

09:00–17:00

09:00 → OPEN
09:01 → OPEN
16:59 → OPEN
17:00 → CLOSED

Choose and document the boundary semantics.

Be consistent everywhere.

---

# 21. ADMIN HOURS EDITOR

Build an hours editor into the existing restaurant administration UI.

Do not create a separate application.

Use the existing restaurant overview/profile page where appropriate.

The UI should allow the administrator to configure each day.

At minimum:

Monday
Tuesday
Wednesday
Thursday
Friday
Saturday
Sunday

Each day should support:

- closed
- opening time
- closing time

The UI must clearly indicate overnight periods.

Example:

10:00 PM → 2:00 AM

should not look like an invalid same-day interval.

---

# 22. ADMIN UX

Follow existing frontend conventions.

Use existing:

- form state
- validation
- error mapping
- API client
- server actions
- shared UI primitives

Do not introduce another form architecture.

Do not introduce a component library unless it already exists.

Do not install shadcn/ui.

Do not redesign the admin shell.

---

# 23. PUBLIC WEB UI

Update the public restaurant page to show operating hours.

The existing page already contains:

Restaurant header
Menu
Menu navigation

Add a suitable hours/status presentation without redesigning the entire page.

At minimum display:

Open now
or
Closed

and the configured operating hours.

Keep the existing mobile-first design.

Do not add large decorative UI.

Do not break the existing menu experience.

---

# 24. ACCESSIBILITY

Maintain existing accessibility standards.

Requirements:

- semantic headings
- keyboard-accessible controls
- visible focus states
- labels for all form controls
- no information conveyed by color alone
- closed/open state must have textual meaning
- screen-reader-friendly time information

Do not rely solely on icons.

---

# 25. VALIDATION

Extend:

packages/validation

with appropriate hours/timezone schemas.

Reuse common validation utilities where appropriate.

Validate:

- timezone
- dayOfWeek
- minute-of-day
- opening/closing combinations
- closed state

Reject:

negative minutes
values > 1439
invalid timezone identifiers
invalid day values

Do not use unsafe coercion.

Follow the existing project's Zod conventions.

---

# 26. RESPONSE SHAPES

Follow the existing API envelope:

success + data

and:

success: false
error: ...

Do not introduce a second response format.

Keep OpenAPI generated/documented from the same schemas used by validation.

---

# 27. ERROR HANDLING

Use existing domain errors.

Do not leak:

- Prisma errors
- stack traces
- database connection information
- filesystem paths
- internal configuration

Follow the existing centralized error handler.

---

# 28. DATABASE CONSTRAINTS

The database itself must enforce:

- restaurant ownership of hours
- one hours record per restaurant/day
- valid relationships

Do not rely solely on application code for uniqueness.

Inspect existing cascade behavior.

When a restaurant is deleted, its hours should not become orphans.

Use the same domain conventions already used by categories/menu items.

---

# 29. EXISTING DATA

There may already be Restaurant records.

The migration must not break them.

Existing restaurants must receive a valid timezone according to the deliberate default strategy.

Existing API consumers must continue working.

Do not make unrelated fields suddenly required unless migration and product requirements justify it.

---

# 30. PUBLIC RESPONSE COMPATIBILITY

Preserve all existing public Restaurant fields.

Do not accidentally remove:

id
name
slug
description
address
city
country
currency

or any other currently documented public field.

Add hours/status in an additive way.

---

# 31. EXISTING ADMIN RESPONSE COMPATIBILITY

Preserve:

restaurant
role

from:

GET /admin/restaurants/:restaurantId

Do not change the existing authorization contract.

Do not move role into the Restaurant record.

Do not modify membership behavior.

---

# 32. SECURITY

Do not weaken:

- authentication
- authorization
- tenant isolation
- CSRF
- CORS
- rate limiting
- trusted proxy handling
- security headers
- error redaction
- log redaction

Every admin hours operation must be tenant-scoped.

A user belonging to restaurant A must never modify restaurant B's hours.

Test this explicitly.

---

# 33. TESTING REQUIREMENTS

Do not just test the happy path.

Add comprehensive tests.

At minimum:

## Database

- migration succeeds
- unique restaurant/day constraint
- cascade behavior
- existing restaurant migration compatibility

## Validation

- valid timezone
- invalid timezone
- valid minute values
- invalid minute values
- valid days
- invalid days
- closed day
- normal hours
- overnight hours
- invalid combinations

## Authorization

OWNER can manage hours.

STAFF behavior must follow the existing capability policy.

Non-member cannot access another restaurant.

Cross-tenant path attacks must return the existing appropriate response.

## API

GET public restaurant includes hours.

GET public restaurant includes correct status.

Admin GET hours.

Admin update hours.

Invalid payload.

Unauthorized.

Forbidden.

Nonexistent restaurant.

Cross-tenant access.

## Time calculation

Normal daytime.

Opening boundary.

Closing boundary.

Closed day.

Overnight.

Previous-day overnight.

Timezone conversion.

DST.

Multiple days.

Missing configuration.

---

# 34. DETERMINISTIC TIME TESTING

Never write tests whose result depends on the actual current time.

Bad:

expect(isOpen(hours, timezone)).toBe(...)

Good:

expect(
  isOpen(
    hours,
    "Asia/Kolkata",
    "2026-08-30T10:00:00Z"
  )
).toBe(...)

The exact representation should follow the implementation's chosen time API, but tests must always use explicit instants.

---

# 35. OPENAPI

Update OpenAPI.

Every new endpoint must have:

- parameters
- request schema
- response schema
- validation errors
- auth requirements
- forbidden/not-found behavior

Run OpenAPI conformance tests.

Do not manually duplicate schemas if the existing project generates them from Zod.

---

# 36. FRONTEND API CLIENT

Do not call fetch directly from React components.

Follow the existing architecture:

component
↓
page/action
↓
lib/api
↓
API

Admin mutations should follow the existing Server Action pattern.

Public data fetching should follow the existing server-side API pattern.

Do not expose private API configuration to the browser.

---

# 37. CACHING

Preserve the existing public restaurant caching strategy unless Phase 5 genuinely requires a change.

The existing restaurant tag:

restaurant:{slug}

should continue to be used.

If hours are included in the restaurant public response, they should participate in the same cache invalidation strategy.

Admin reads/mutations must preserve the existing no-store/mutation behavior.

Do not invent a second caching system.

---

# 38. IMPORTANT KNOWN TECHNICAL DEBT

The project currently has known issues that are NOT part of this phase.

Do not fix them unless required to implement Phase 5 safely:

- admin write rate limiting
- distributed rate limiter
- media
- QR
- member management
- password reset
- email verification
- analytics
- bulk reorder
- menu-item deep links
- apps/docs cleanup
- shadcn/ui installation
- speculative caching changes

Do not expand scope.

---

# 39. SMALL PRE-EXISTING FIXES

Before finishing Phase 5, address only these already-identified small issues if they remain unresolved:

1. Admin menu category item counts are incorrect above 100.
   Prefer a backend category `menuItemCount` if that fits the existing architecture.

2. apps/web `PublicRestaurant` is missing `currency`.

These are known bugs from the previous audit.

If they are already fixed, do nothing.

Do not use them as an excuse for broader refactoring.

---

# 40. DO NOT CHANGE

Do NOT change:

- PostgreSQL host port 5433
- Docker database setup
- Prisma provider
- existing composite foreign keys
- cascade rules
- money representation
- RestaurantMembership capability table
- 403 backend behavior for forbidden access
- frontend 403 → notFound mapping
- public caching strategy
- existing modular monolith architecture
- admin standalone ESLint/TypeScript configuration
- existing authentication design
- Better Auth configuration
- public/private API boundary

Unless a change is absolutely required by the Phase 5 specification.

---

# 41. DOCUMENTATION

Update documentation only where the implementation genuinely changes the architecture or project state.

Update:

AI_ENGINEER.md
ARCHITECTURE.md
PROJECT_ROADMAP.md

where appropriate.

Document:

- timezone model
- operating-hours model
- overnight representation
- open/closed calculation
- default timezone decision
- any remaining limitations

Do not write fictional future completion claims.

---

# 42. FINAL VERIFICATION

Before declaring the phase complete, run:

bun run lint
bun run check-types
bun run build
bun run test

Run them from the repository root.

Do not rely on cached Turbo results.

Force or otherwise verify fresh execution where practical.

All relevant tests must pass.

---

# 43. DATABASE VERIFICATION

Verify directly against PostgreSQL:

- OperatingHours exists
- Restaurant timezone exists
- constraints exist
- unique restaurant/day constraint exists
- foreign key exists
- cascade behavior is correct
- migration bookkeeping is correct

Do not rely exclusively on Prisma CLI output.

---

# 44. LIVE HTTP VERIFICATION

Run the actual API and verify with real HTTP requests:

1. public restaurant without hours
2. public restaurant with normal hours
3. public restaurant with overnight hours
4. admin read
5. admin update
6. unauthorized request
7. cross-tenant request
8. invalid timezone
9. invalid time
10. open/closed response

Also verify the actual Next.js public page against the running API.

---

# 45. SECURITY REGRESSION

Confirm that existing security tests still pass.

Specifically ensure:

- no tenant isolation regression
- no role escalation
- no mass assignment
- no unauthorized hours update
- no private field leakage
- no stack/DSN leakage

---

# 46. PERFORMANCE

Measure the public restaurant endpoint.

Do not introduce N+1 queries.

If hours are included in the public restaurant response, verify query count.

A restaurant with many menu categories/items must not result in a query per hours record/day.

The expected hours query should remain bounded.

---

# 47. ARCHITECTURAL REVIEW

After implementation, inspect the resulting architecture.

Ask:

- Did we create unnecessary abstractions?
- Did we duplicate validation?
- Did we bypass the repository layer?
- Did we bypass authorization?
- Did we introduce frontend/backend coupling?
- Did we expose internal database fields?
- Did we introduce a new response format?
- Did we create an unnecessary package?
- Did we create an unnecessary dependency?
- Did we change unrelated functionality?

Fix any issue introduced by this phase.

---

# 48. FINAL REPORT

When finished, do NOT simply say "done".

Provide a structured final report containing:

## 1. Files created

List every file.

## 2. Files modified

List every file.

## 3. Files deleted

List every file, or say none.

## 4. Database changes

Explain:

- models
- fields
- constraints
- migration
- verification

## 5. API changes

List:

- endpoints
- request shapes
- response shapes
- auth requirements

## 6. Frontend changes

Explain:

- public UI
- admin UI
- open/closed status
- hours editor

## 7. Timezone design

Explain exactly:

- timezone representation
- default
- local-time conversion
- overnight handling
- DST handling

## 8. Security

Explain tenant isolation and authorization tests.

## 9. Tests

Report:

- total tests
- passed
- failed
- assertions

Also report:

- lint
- type-check
- build

## 10. Live verification

Report the real HTTP/database checks performed.

## 11. Technical debt

List remaining issues honestly.

Do not hide known limitations.

## 12. Architecture assessment

State whether the modular monolith architecture remains intact.

## 13. Recommended next phase

Do NOT implement it.

Only recommend what should come next based on the current roadmap.

---

# 49. GIT RULE

DO NOT run:

git add
git commit
git push

Do not stage anything.

At the end show:

git status

and summarize what is uncommitted.

The human owner will decide when to commit.

---

# 50. STOP CONDITION

When Phase 5 is complete:

STOP.

Do not continue automatically into:

Phase 6
Phase 7
Media
QR
Analytics
Members
Email
Password recovery
Anything else.

Wait for further instructions.

---

# SUCCESS CRITERIA

Phase 5 is complete only when:

[ ] Restaurant timezone exists and is validated
[ ] OperatingHours exists
[ ] Migration is applied and verified
[ ] Existing data survives
[ ] Normal hours work
[ ] Closed days work
[ ] Overnight hours work
[ ] Previous-day overnight logic works
[ ] Timezone conversion works
[ ] DST behavior is tested
[ ] Public API exposes hours
[ ] Public API exposes correct open/closed state
[ ] Admin can read hours
[ ] Admin can update hours
[ ] Tenant isolation is verified
[ ] Authorization is verified
[ ] OpenAPI is updated
[ ] Public frontend displays status/hours
[ ] Admin frontend edits hours
[ ] Accessibility is preserved
[ ] No N+1 introduced
[ ] Existing tests still pass
[ ] New tests pass
[ ] lint passes
[ ] type-check passes
[ ] build passes
[ ] documentation is updated
[ ] no unrelated features were implemented
[ ] no git commit was created

ONLY after every applicable item is verified should you report:

PHASE_5_COMPLETE