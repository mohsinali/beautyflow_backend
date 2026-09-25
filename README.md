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

Provider photos use local storage by default. `PROVIDER_PHOTO_UPLOAD_DIR` selects the storage directory (default `./uploads/provider-photos`) and `PROVIDER_PHOTO_MAX_BYTES` sets the upload limit (default 5 MiB). Production deployments must mount this directory as persistent storage until an S3-compatible storage implementation is introduced.

Provider invitations use Nodemailer through the Amazon SES SMTP interface. Configure `SMTP_HOST` with the standard regional SES endpoint (for example, `email-smtp.us-east-1.amazonaws.com`), port 587, `SMTP_SECURE=false`, `SMTP_REQUIRE_TLS=true`, SES SMTP credentials in `SMTP_USER` and `SMTP_PASSWORD`, a verified address in `SMTP_FROM`, and the display name in `MAIL_FROM_NAME`. Also set the trusted frontend `APP_PUBLIC_URL` and `INVITATION_EXPIRY_HOURS` (48 by default). Keep all SMTP credentials in the backend environment; do not expose them to the frontend. In SES sandbox mode, recipient identities must also be verified. When delivery fails, onboarding still succeeds and the invitation can be resent from the provider detail page. Branch assignments, qualified services, and photos are configured after provider creation.

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
# Stage 2: service catalog and provider profiles

BeautyFlow uses **service category** for a tenant-owned grouping, **catalog service** for a
treatment sold by a salon, and **service provider** for a professional who can perform catalog
services. Customer visits, visit items, appointments, schedules, commissions, payments, POS UI,
inventory, and reporting are intentionally deferred.

## Data model and behavior

For a detailed explanation of provider identity, the **Service Provider Membership** field,
`ServiceProviderProfile`, `ProviderService`, branch assignment, and eligibility, see
[Service provider domain model](docs/service-provider-domain.md).

- `ServiceCategory` and `CatalogService` are tenant-owned, Unicode-safe, soft-state records.
  Server-maintained NFKC/lowercase normalized names prevent accidental duplicates. Service codes
  are normalized to uppercase and are unique per tenant. Prices are PostgreSQL `DECIMAL(12,2)`.
- `BranchService` stores only exceptions. With no row, an active service is available and uses its
  default price. A row can disable it and/or override its price. Effective availability also
  requires the category and service to be active; deactivating either therefore removes it from
  operational catalog listings without deleting history.
- `ServiceProviderProfile` is a one-to-one extension of an existing `SERVICE_PROVIDER`
  `TenantMembership`; it never creates another login identity. Branch access remains exclusively in
  `MembershipBranch`. `ProviderService` records tenant-wide qualifications.
- Structural eligibility requires an active tenant, branch, user, membership, profile, category and
  service; an existing membership-to-branch assignment; a qualification; and effective branch
  availability. It does not evaluate schedules or appointment-time availability.
- Composite tenant foreign keys plus tenant-scoped application lookups reject cross-tenant links.
  Foreign resource IDs return the same not-found response as missing resources.

## API and authorization

All routes use `/api/v1`, bearer authentication, the standard response envelope, pagination, and
structured error codes. Swagger is available at `/api/docs` when `SWAGGER_ENABLED=true`.

- Categories: `POST/GET /service-categories`, `GET/PATCH /service-categories/:id`, and
  `POST /service-categories/:id/deactivate|reactivate`.
- Services: `POST/GET /catalog-services`, `GET/PATCH /catalog-services/:id`, and
  `POST /catalog-services/:id/deactivate|reactivate`.
- Branch catalog: `GET /branches/:branchId/catalog-services`,
  `PUT /branches/:branchId/catalog-services/:serviceId`, and
  `DELETE /branches/:branchId/catalog-services/:serviceId/configuration`.
- Providers: `POST /service-providers/onboard` creates the login, membership, profile and secure
  invitation atomically; `POST /service-providers/:id/resend-invitation` replaces an outstanding
  invitation. Existing profile, status and qualification routes remain available.
- Invitations: public rate-limited `POST /auth/invitations/validate` and
  `POST /auth/invitations/accept` routes validate a single-use token and complete account setup.
- Eligibility: `GET /branches/:branchId/catalog-services/:serviceId/eligible-providers`.

Salon Owners receive all Stage 2 management permissions. Receptionists can read active categories,
assigned-branch catalogs, assigned-branch active providers, and eligibility results. Service
Providers can read assigned-branch catalogs and only their own profile/qualifications. Neither
staff role can mutate catalog, pricing, profile, or qualification data. Platform Super Admin still
requires explicit tenant context and is not silently admitted to tenant routes.

Example bodies:

```json
{ "name": "Hair", "color": "#7C3AED", "sortOrder": 10 }
```

```json
{
  "categoryId": "00000000-0000-4000-8000-000000000001",
  "name": "Haircut",
  "code": "CUT",
  "defaultPrice": 1500.00,
  "durationMinutes": 45
}
```

```json
{ "isAvailable": true, "priceOverride": 1750.00 }
```

```json
{
  "membershipId": "00000000-0000-4000-8000-000000000002",
  "displayName": "Sam Stylist",
  "jobTitle": "Senior Stylist"
}
```

```json
{ "serviceIds": ["00000000-0000-4000-8000-000000000003"] }
```

The branch catalog and eligible-provider examples are read with:

```text
GET /api/v1/branches/{branchId}/catalog-services
GET /api/v1/branches/{branchId}/catalog-services/{serviceId}/eligible-providers
```

## Migration, seed, and verification

Migration `20260918020000_stage_2_service_catalog_providers` creates all five Stage 2 entities,
indexes, checks, and tenant-consistent foreign keys. The idempotent seed adds Hair, Nails, Makeup,
and Skin Care; eight services; a disabled branch service; a branch price override; two providers;
branch assignments; and distinct qualifications while preserving foundation accounts.

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run prisma:seed # idempotency check
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```
