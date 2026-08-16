# Digital Restaurant Experience Platform

## Backend Completion — Autonomous Implementation

You are the Senior Backend Engineer responsible for completing the backend of this project.

The project already has an established architecture and implementation.

Your job is to **inspect the current repository and complete the backend**, not redesign the architecture.

---

# 1. SOURCE OF TRUTH

Before doing anything:

Read completely:

* `AI_ENGINEER.md`
* `ARCHITECTURE.md` if present
* `DATABASE_SPEC.md` if present
* `BACKEND_SPEC.md` if present
* `PROJECT_ROADMAP.md` if present

Then inspect the actual repository.

The repository state is authoritative over assumptions in these documents.

If documentation and implementation disagree:

1. Identify the discrepancy.
2. Determine the safest correction.
3. Update the relevant documentation.
4. Continue unless the decision would materially change the architecture.

Do not blindly follow old instructions if the actual repository has evolved.

---

# 2. LOCKED ARCHITECTURE

Do NOT change these unless there is a serious technical reason and explicit approval:

* Monorepo: Turborepo
* Package manager/runtime: Bun
* Frontend: Next.js App Router
* Backend: Bun + Hono
* Language: TypeScript
* Database: PostgreSQL
* ORM: Prisma
* Validation: Zod
* Styling: Tailwind CSS + shadcn/ui
* Storage: Cloudflare R2
* Architecture: Modular Monolith
* Repository: Monorepo

Do NOT introduce microservices.

Do NOT introduce MongoDB.

Do NOT replace Prisma.

Do NOT replace Hono.

Do NOT introduce unnecessary infrastructure.

---

# 3. CURRENT BACKEND STATUS

Already completed:

* Turborepo
* apps/web
* apps/admin
* apps/api
* Docker PostgreSQL
* PostgreSQL development database
* Prisma
* shared `@repo/database`
* Restaurant Prisma model
* Restaurant repository
* Restaurant service
* Restaurant controller
* Restaurant routes
* `@repo/validation`
* Zod validation
* centralized API errors
* response helpers
* pagination
* Restaurant CRUD

The development PostgreSQL database runs through Docker on host port `5433`.

Do not revert this.

---

# 4. YOUR MISSION

Complete the backend foundation and core backend functionality required before frontend development begins.

Work through the following milestones in order.

Do not skip required infrastructure.

Do not prematurely implement future business features.

---

# MILESTONE A — Backend Infrastructure

Implement and verify:

## Configuration

Create centralized typed configuration.

Requirements:

* Environment variables validated with Zod.
* Fail fast when required variables are missing.
* No direct `process.env` access scattered throughout application code.
* Keep secrets out of source control.

Required configuration should include at minimum:

* DATABASE_URL
* API_PORT
* NODE_ENV
* CORS configuration

Only add additional variables when actually required.

---

# MILESTONE B — Logging

Implement production-quality structured logging.

Requirements:

* debug
* info
* warn
* error

Logs should contain useful context.

At minimum support:

* timestamp
* level
* message
* request ID
* error information when applicable

Do not log:

* passwords
* tokens
* database credentials
* sensitive personal information

Keep logging implementation replaceable.

Do not spread logger-specific code throughout business logic unnecessarily.

---

# MILESTONE C — Request IDs

Implement request ID middleware.

Every request must have a request ID.

Requirements:

* Accept an incoming request ID when appropriate.
* Generate one when missing.
* Attach it to request context.
* Include it in response headers.
* Include it in logs.

Use a safe, collision-resistant identifier.

---

# MILESTONE D — Health & Readiness

Implement:

GET /health

GET /ready

`/health`:

* confirms the API process is alive.

`/ready`:

* verifies required dependencies.
* currently verify PostgreSQL connectivity.

Responses must be simple and machine-readable.

Example concept:

```json
{
  "status": "ok"
}
```

Do not expose credentials or internal infrastructure details.

---

# MILESTONE E — Error Handling

Review the existing error system.

Ensure:

* Validation errors → 400
* Authentication errors → 401
* Authorization errors → 403
* Not found → 404
* Conflict → 409
* Rate limiting → 429
* Unexpected errors → 500

Unexpected errors must not expose stack traces or internal database information in production responses.

Every error should include the request ID when appropriate.

Preserve the existing response envelope unless there is a strong reason to change it.

---

# MILESTONE F — CORS

Implement controlled CORS.

Do NOT use:

```text
Access-Control-Allow-Origin: *
```

for authenticated/admin APIs.

Support configuration through environment variables.

Prepare for:

* web application
* admin application
* local development

---

# MILESTONE G — Security Middleware

Implement appropriate baseline security protections for the Hono API.

Consider:

* secure headers
* body size limits
* request validation
* CORS
* rate limiting where appropriate
* HTTP method handling
* safe error responses

Do not add complicated security infrastructure without justification.

Document what is implemented and why.

---

# MILESTONE H — OpenAPI

Add OpenAPI documentation for the API.

Requirements:

* Restaurant endpoints documented.
* Request schemas documented.
* Response schemas documented.
* Error responses documented.
* Health endpoints documented.
* Validation constraints represented where possible.

Expose API documentation through a development-friendly endpoint.

Do not expose internal secrets.

---

# MILESTONE I — Authentication Foundation

Implement authentication for the restaurant administration system.

Before implementing:

1. Inspect current project.
2. Choose the simplest production-appropriate authentication solution compatible with:

   * Bun
   * Hono
   * Next.js
   * Prisma
   * PostgreSQL
3. If an authentication library is required, explain the choice.
4. Do not invent a custom cryptographic authentication system.

Authentication must support the future concept:

```text
User
  ↓
Restaurant membership
  ↓
Role
  ↓
Permissions
```

At minimum prepare for:

* owner
* staff

Do not implement unnecessary roles yet.

Passwords, if used, must be securely hashed.

Sessions/tokens must follow modern security practices.

Never store plaintext passwords.

---

# MILESTONE J — Authorization

Implement authorization boundaries.

A user must only be able to access restaurants they are authorized to manage.

Do NOT rely only on frontend checks.

Authorization must be enforced by the backend.

Design it so future roles/permissions can expand without rewriting every route.

---

# MILESTONE K — Restaurant Ownership

Connect authentication to the Restaurant domain.

The system must support:

```text
User
  ↓
Restaurant Membership
  ↓
Restaurant
```

Avoid directly assuming:

```text
Restaurant.ownerId
```

if that would prevent future staff/multiple-user support.

Choose the appropriate relational model based on the existing architecture.

Explain the decision before implementing if it materially changes the current database.

---

# MILESTONE L — Restaurant API Hardening

Review the existing Restaurant API.

Ensure:

* authentication where required
* authorization
* validation
* pagination
* deterministic sorting
* safe error handling
* consistent responses
* race-condition-safe uniqueness handling
* appropriate database indexes
* no accidental data leakage

Public restaurant information and administrative restaurant information should be clearly separated.

Do not expose internal fields unnecessarily.

---

# MILESTONE M — Database Quality

Review the complete Prisma schema.

Do NOT add future business models merely for theoretical scalability.

For existing models verify:

* IDs
* timestamps
* indexes
* unique constraints
* foreign keys
* nullability
* cascade/restrict behavior
* naming consistency

Use migrations for schema changes.

Do not use destructive database commands against production.

Document migration procedures.

---

# MILESTONE N — API Testing

Create a proper backend test foundation.

At minimum cover:

* Restaurant creation
* Validation failures
* Duplicate slug
* Restaurant retrieval
* Restaurant update
* Restaurant deletion
* Pagination
* Authentication
* Authorization
* Health
* Readiness
* Error handling

Test both success and failure paths.

Do not write tests merely to increase coverage percentage.

Prioritize business-critical behavior.

---

# MILESTONE O — API Documentation

Ensure the backend README explains:

* local setup
* environment variables
* PostgreSQL Docker setup
* Prisma commands
* migrations
* development server
* testing
* API documentation
* health endpoints
* authentication
* troubleshooting

Keep documentation synchronized with implementation.

---

# 5. DATABASE RULES

Do not create these yet unless required by the current milestone:

* Category
* MenuItem
* Order
* Reservation
* Review
* Analytics event warehouse
* Subscription
* Payment

Those belong to later product phases.

The current backend foundation should remain focused.

---

# 6. CODE ORGANIZATION

Continue the current modular structure.

Example:

```text
apps/api/

src/

modules/

restaurants/
    restaurant.routes.ts
    restaurant.controller.ts
    restaurant.service.ts
    restaurant.repository.ts

auth/
...

shared/
    errors.ts
    http.ts
    error-handler.ts
    ...
```

Keep modules flat while each layer has one file.

Only introduce subfolders when a layer naturally grows to multiple files.

Do not create folders just for theoretical organization.

---

# 7. SHARED PACKAGES

Use shared packages only when there is a real shared responsibility.

Current:

```text
packages/database
packages/validation
packages/ui
packages/typescript-config
packages/eslint-config
```

Do not create additional packages merely because they appear in an architectural diagram.

---

# 8. QUALITY GATES

After each milestone run:

```bash
bun run lint
bun run check-types
bun run build
```

Run relevant tests.

Fix failures before proceeding.

Do not suppress errors just to make CI pass.

Do not use:

```ts
any
```

unless there is a documented and unavoidable reason.

---

# 9. DATABASE VERIFICATION

The project database is:

```text
localhost:5433
```

Do not accidentally connect to the native Windows PostgreSQL instance on `5432`.

Before destructive database operations:

* verify DATABASE_URL
* verify target database
* verify environment

Never delete unrelated databases.

---

# 10. PRISMA GENERATE ISSUE

There has previously been intermittent Prisma Client generation behavior in this development environment.

Do not assume an exit code means the generated client is valid.

After generation:

* verify generated output exists
* verify generated files are non-empty
* verify the client can actually import
* run a smoke test

Do not hide this issue.

If the problem remains reproducible, document it as an engineering issue.

Do not build unnecessary production workarounds unless required.

---

# 11. GIT DISCIPLINE

Do not automatically commit.

At the end of each milestone provide:

```text
Recommended commit:

<message>
```

The developer will decide when to commit.

Never rewrite existing Git history.

Never force push.

Never delete branches.

---

# 12. DOCUMENTATION SYNCHRONIZATION

After meaningful architectural changes:

Update the appropriate `.md` files.

Do not create duplicate documentation.

Keep:

* AI_ENGINEER.md
* ARCHITECTURE.md
* DATABASE_SPEC.md
* BACKEND_SPEC.md
* PROJECT_ROADMAP.md

consistent with the actual implementation.

If these files don't exist yet, create them using the project's current architecture and implementation as the source of truth.

---

# 13. AUTONOMOUS EXECUTION

You have permission to complete the backend milestones sequentially.

Do NOT stop after every tiny change asking for approval.

Continue until:

* backend infrastructure is complete
* authentication/authorization foundation is complete
* Restaurant API is hardened
* tests exist
* documentation is updated
* lint passes
* type-check passes
* build passes

However:

STOP and report if you encounter:

1. A decision that materially changes the architecture.
2. A security-critical uncertainty.
3. A destructive database operation that requires human approval.
4. A conflict between existing architecture documents.
5. A dependency choice that would replace an existing core technology.
6. A production data migration risk.

Do not silently make those decisions.

---

# 14. FINAL BACKEND ACCEPTANCE CRITERIA

The backend phase is complete only when:

* [ ] API starts successfully
* [ ] PostgreSQL connection works
* [ ] Prisma works reliably
* [ ] migrations are documented
* [ ] configuration is validated
* [ ] structured logging works
* [ ] request IDs work
* [ ] health endpoint works
* [ ] readiness endpoint works
* [ ] CORS is configured
* [ ] baseline security middleware exists
* [ ] OpenAPI documentation exists
* [ ] authentication works
* [ ] authorization works
* [ ] restaurant ownership works
* [ ] Restaurant CRUD is protected appropriately
* [ ] validation works
* [ ] error handling is consistent
* [ ] tests cover critical backend behavior
* [ ] lint passes
* [ ] type-check passes
* [ ] build passes
* [ ] documentation is updated
* [ ] no unnecessary future business models were added
* [ ] no architectural changes were made without approval

---

# FINAL REPORT

When the backend phase is complete, provide:

1. Final backend architecture
2. Final folder structure
3. Database schema summary
4. Authentication architecture
5. Authorization architecture
6. API endpoint list
7. Security measures
8. Testing summary
9. Environment setup
10. Known issues
11. Technical debt
12. Future recommendations
13. Files created
14. Files modified
15. Commands executed
16. Final validation results
17. Recommended final backend commit message

Then STOP.

Do not start frontend implementation.

The next phase will be reviewed separately.
