# BeautyFlow backend

Production-oriented foundation for a multi-tenant salon SaaS. It is a NestJS modular monolith backed by PostgreSQL (Prisma) and Redis. This stage deliberately contains identity, tenancy, branches, authorization, auditing, health, and infrastructure only.

## Architecture

Requests pass through request-ID assignment, rate limiting, JWT authentication with live account/context checks, centralized permission checks, and optional branch-context validation. Controllers contain HTTP concerns; services own business rules and every tenant-owned query includes an authenticated `tenantId`. PostgreSQL constraints independently protect unique identities, branch codes, memberships, and same-tenant branch assignments.

```text
src/
├── auth/             login, token rotation, logout, current session
├── users/            login-identity module boundary
├── tenants/          platform provisioning and tenant settings
├── branches/         tenant-scoped branch lifecycle
├── memberships/      staff, roles, status, branch access
├── authorization/    JWT context, permissions, branch access
├── audit/            append-only security/business audit events
├── health/           liveness and dependency readiness
├── prisma/           database client
├── redis/            Redis lifecycle and readiness
├── common/           HTTP conventions and shared request context
└── config/           startup environment validation
```

## Prerequisites and setup

- Node.js 20.19.6 (pinned by `.nvmrc`, `.node-version`, and `package.json`)
- npm 10.8.2
- Docker with Compose, or separately managed PostgreSQL and Redis

```bash
nvm install
nvm use
cp .env.example .env
npm install
docker compose up -d
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run start:dev
```

The API is at `http://localhost:3000/api/v1`. With `SWAGGER_ENABLED=true`, Swagger is at `http://localhost:3000/api/docs`. Docker publishes PostgreSQL on host port `5433` by default (configurable with `POSTGRES_PORT`) to avoid colliding with a workstation PostgreSQL on `5432`; Redis uses `6379`. Both use persistent named volumes. To run dependencies without Docker, point `DATABASE_URL` and `REDIS_URL` at local or hosted instances, create the separate database named by `TEST_DATABASE_URL`, then run the same migration and application commands.

Useful commands:

```bash
docker compose up -d                 # PostgreSQL + Redis
docker compose down                  # stop; persistent data remains
npm run prisma:migrate               # create/apply a development migration
npm run prisma:migrate:deploy        # apply checked-in migrations
npm run prisma:seed                   # idempotent development data
npm run format && npm run lint
npm run typecheck && npm run build
npm run test:unit
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
npm run test:e2e
```

Environment is validated at startup. Secrets must be at least 32 characters and must differ in deployed environments. `CORS_ORIGINS` is a comma-separated allowlist. `TRUST_PROXY` is `0`, a hop count, or a boolean and must match the actual reverse-proxy topology. Swagger should be disabled in production unless intentionally protected. Never commit `.env`.

`prisma.config.ts` explicitly loads the root `.env`, so Prisma CLI commands use the same `DATABASE_URL` as the application. For the supplied Docker Compose stack, retain the example URL using user `beautyflow` and host port `5433`; a locally installed PostgreSQL user such as `postgres` has different credentials and is not the Compose database.

## Authentication and tenant resolution

Login example:

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","password":"ChangeMe123!","tenantSlug":"glow-salon"}'
```

Access tokens are short-lived JWTs. Passwords use bcrypt with a work factor of 12. Refresh tokens are separately signed JWTs; only SHA-256 token digests are stored because refresh tokens are already high-entropy random credentials. Refresh rotates the session token, and detected reuse revokes the remaining token family. Logout revokes the current session and logout-all revokes all of the user's sessions. API serializers never expose password hashes or stored refresh-token hashes.

For a browser frontend, keep access tokens in memory. The current JSON API returns a refresh token only from login/refresh; do not put it in local storage. A production browser deployment should place it in a `Secure`, `HttpOnly`, `SameSite` cookie in a same-site backend-for-frontend or API gateway and add CSRF protection. Native clients should use OS secure storage. Submit the refresh token only to `POST /auth/refresh`; never log it.

A login with `tenantSlug` selects that active membership. It can be omitted when a non-platform user has exactly one active tenant. Multiple memberships without a slug produce `TENANT_SELECTION_REQUIRED` and a safe tenant choice list. A Super Admin can log in without a tenant; platform status does not bypass tenant guards. Suspended/inactive users, tenants, and memberships are rejected, and protected requests revalidate live status.

Protected request:

```bash
curl http://localhost:3000/api/v1/branches \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'X-Branch-Id: BRANCH_UUID'
```

`X-Branch-Id` is optional for tenant-wide administration. When present it must be an active branch in the authenticated tenant. Salon Owners can select any active tenant branch; other roles can select only explicit assignments. A non-owner with exactly one assignment defaults to that branch. Invalid, inaccessible, and cross-tenant IDs return `404`.

## API

- `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/me`
- `POST|GET /platform/tenants`, `GET|PATCH /platform/tenants/:tenantId`, `POST /platform/tenants/:tenantId/suspend|reactivate`
- `GET|PATCH /tenant/settings`
- `POST|GET /branches`, `GET|PATCH /branches/:branchId`, `POST /branches/:branchId/deactivate|reactivate`
- `POST|GET /memberships`, `GET /memberships/:membershipId`, `PATCH /memberships/:membershipId/role`, `POST /memberships/:membershipId/suspend|reactivate`
- `POST|DELETE /memberships/:membershipId/branches/:branchId`
- `GET /health`, `GET /health/ready`

List endpoints return `{ data: { items, meta } }`; all successes use a `{ data }` envelope. Errors include stable language-neutral `code`, `statusCode`, `message`, optional `details`, and `requestId`.

## Roles and permissions

- `SUPER_ADMIN` is a platform role and can create/view/update/suspend/reactivate tenants. It has no implicit tenant access.
- `SALON_OWNER` is a tenant membership role with settings, branch, staff, membership-role, and branch-assignment administration across its tenant.
- `RECEPTIONIST` and `SERVICE_PROVIDER` can view their own profile/session and only explicitly assigned branches. Future operational permissions are intentionally absent.

Language (`EN` or `AR`) is tenant-level only. Changing it changes only the future interface locale; all tenant-created names and other data remain exactly as entered. Branches can override the tenant timezone; serialized branch data falls back to the tenant timezone. Multiple branches are supported from the MVP. Tenant roles are separate from platform roles.

## Development seed

Values come from `SEED_*` variables; the `.env.example` fallbacks are explicitly development-only.

| Identity       | Default email              | Role             | Access                  |
| -------------- | -------------------------- | ---------------- | ----------------------- |
| Platform admin | `admin@beautyflow.local`   | Super Admin      | platform                |
| Owner          | `owner@example.com`        | Salon Owner      | all Glow Salon branches |
| Receptionist   | `receptionist@example.com` | Receptionist     | `MAIN`                  |
| Provider       | `provider@example.com`     | Service Provider | `NORTH`                 |

The sample tenant is `glow-salon`, with `MAIN` and `NORTH` branches. Defaults use `ChangeMe123!`; replace them outside disposable development. Re-running the seed is safe and does not reset passwords for existing identities.

## Scope and decisions

Soft status/deactivation is used instead of business-record deletion. Tenant creation (tenant, initial branch, user/membership, audit) is transactional. Audit metadata records changed field names and identifiers but never credentials or tokens. Email invitation delivery is deferred; staff can be created directly or an existing login identity can be attached to a tenant.

Customers, service catalog, provider business profiles, visits, visit items, paid-status tracking, payments, and reports are intentionally deferred. Payment processing itself remains outside BeautyFlow; a later stage will track paid status only.
