# Service provider domain model

This document explains how BeautyFlow represents service providers, what the **Service Provider
Membership** field means, and how provider identity, branch access, profile information, and
service qualifications fit together.

## Conceptual model

BeautyFlow deliberately separates the account used to sign in from the professional profile used
inside a salon:

```text
User (login identity)
  └── TenantMembership (role and status in one salon)
        ├── MembershipBranch[] (branches the member can access)
        └── ServiceProviderProfile (professional provider details)
              └── ProviderService[] (services the provider is qualified to perform)
                    └── CatalogService
```

- `User` owns the login identity and personal account data, including email and account status.
- `TenantMembership` says who that user is within a particular tenant. It stores the tenant role
  and membership status.
- `MembershipBranch` assigns that membership to branches.
- `ServiceProviderProfile` contains the salon-facing professional information for a service
  provider.
- `ProviderService` links a provider profile to the catalog services they are qualified to
  perform.

This separation prevents login, authorization, branch access, presentation data, and professional
qualifications from being conflated in a single record.

## The Service Provider Membership field

The **Service Provider Membership** dropdown in the Add Provider form is not a subscription or a
paid membership. It selects an existing `TenantMembership` whose role is `SERVICE_PROVIDER` and
links a new professional profile to it.

For example, selecting:

```text
Sam Stylist — provider@example.com
```

means: create a `ServiceProviderProfile` for the existing tenant membership associated with Sam's
user account. Submitting the form does **not** create another `User`, login, or membership.

The dropdown is populated by `GET /api/v1/service-providers/available-memberships`. A membership
is included only when all of the following are true:

- It belongs to the current tenant.
- Its role is `SERVICE_PROVIDER`.
- Its membership status is active.
- Its associated user is active and not deleted.
- It does not already have a `ServiceProviderProfile`.

Consequently, a person disappears from the dropdown after their provider profile is created. A
membership with another role, an inactive membership or user, or a membership already linked to a
profile is not offered. The API repeats the role, tenant, and uniqueness validation when the form
is submitted; the UI is not the security boundary.

Before a new person can be selected in this form, a tenant membership with the
`SERVICE_PROVIDER` role must exist for them. Membership creation is responsible for creating or
attaching the login identity; provider-profile creation only adds the professional details.

## `ServiceProviderProfile`

`ServiceProviderProfile` is the tenant-owned, professional representation of a provider. It is a
one-to-one extension of `TenantMembership`.

| Column | Responsibility |
| --- | --- |
| `id` | Unique profile identifier. |
| `tenantId` | Tenant that owns the profile. |
| `membershipId` | Associated `SERVICE_PROVIDER` tenant membership. |
| `displayName` | Name displayed to staff and customers. |
| `normalizedName` | Server-maintained normalized value used for search and ordering. |
| `phone` | Optional professional contact number. |
| `jobTitle` | Optional professional title, such as Senior Stylist. |
| `bio` | Optional professional biography. |
| `profileImageUrl` | Optional external or legacy profile-image location. |
| `photoStorageKey` | Storage identifier for an uploaded provider photo. |
| `isActive` | Whether the professional profile itself is active. |
| `deletedAt` | Soft-deletion marker. |
| `createdAt`, `updatedAt` | Record timestamps. |

The unique constraint on `membershipId` enforces the one-to-one relationship: the same membership
cannot own two provider profiles. The composite foreign key `(membershipId, tenantId)` ensures the
profile and membership belong to the same tenant.

The profile does not own the provider's credentials, email, tenant role, membership status, or
branch access. Those remain on `User`, `TenantMembership`, and `MembershipBranch` respectively.
Changing profile data therefore cannot grant login or branch permissions.

The API's `effectivelyActive` response field is stricter than `ServiceProviderProfile.isActive`.
It is true only when the profile, membership, and associated user are all active.

## `ProviderService`

`ProviderService` is a junction table between `ServiceProviderProfile` and `CatalogService`. Each
row records one tenant-wide qualification:

```text
Sam's profile + Haircut
Sam's profile + Hair Coloring
Alex's profile + Haircut
```

This produces a many-to-many relationship: a provider can perform many catalog services, and a
catalog service can be performed by many providers.

| Column | Responsibility |
| --- | --- |
| `id` | Unique qualification identifier. |
| `tenantId` | Tenant that owns the relationship. |
| `providerProfileId` | Provider profile receiving the qualification. |
| `catalogServiceId` | Catalog service the provider may perform. |
| `createdAt` | Time the qualification was assigned. |

The unique constraint on `(providerProfileId, catalogServiceId)` prevents duplicate
qualifications. Composite tenant foreign keys prevent cross-tenant links. Deleting the provider
profile or catalog service cascades to its `ProviderService` rows.

A `ProviderService` row expresses professional qualification, not branch access, branch catalog
availability, a working schedule, or availability at a particular appointment time.

## Branch assignment versus service qualification

`MembershipBranch` and `ProviderService` answer different questions:

| Relationship | Question answered |
| --- | --- |
| `MembershipBranch` | At which branches can this member operate? |
| `ProviderService` | Which services is this provider qualified to perform? |
| `BranchService` | Is this catalog service available at this branch, and is its price overridden? |

None of these relationships substitutes for the others. For example, assigning Sam to the North
branch does not qualify Sam to perform every service there, and qualifying Sam for Haircut does not
grant access to every branch.

## Eligibility at a branch

For the eligible-provider endpoint to return a provider for a particular branch and catalog
service, the current implementation requires all of the following structural conditions:

- The tenant, branch, user, membership, and provider profile are active and not deleted where
  applicable.
- The membership is assigned to the branch through `MembershipBranch`.
- The provider has a matching `ProviderService` qualification.
- The service and its category are active and not deleted.
- The service is effectively available at the branch according to the branch catalog.

These checks establish structural eligibility only. They do not yet evaluate working schedules,
leave, existing appointments, or appointment-time availability.

## Provider onboarding lifecycle

A typical provider is configured in this order:

1. Create a user or attach an existing login identity to the tenant.
2. Create an active `TenantMembership` with the `SERVICE_PROVIDER` role.
3. Assign the membership to one or more branches with `MembershipBranch`.
4. Select that membership in the Add Provider form to create its `ServiceProviderProfile`.
5. Assign catalog-service qualifications, creating `ProviderService` rows.

After these steps, the provider can be returned as eligible when the relevant branch and catalog
service also satisfy the conditions above.

## Relevant API routes

- `GET /api/v1/service-providers/available-memberships` lists memberships that can receive a
  provider profile.
- `POST /api/v1/service-providers` creates a profile for an existing membership.
- `GET|PATCH /api/v1/service-providers/:providerId` reads or updates profile details.
- Provider qualification routes under `/api/v1/service-providers/:providerId/qualifications` list,
  replace, add, or remove `ProviderService` assignments.
- `POST|DELETE /api/v1/memberships/:membershipId/branches/:branchId` manages branch assignments.
- `GET /api/v1/branches/:branchId/catalog-services/:serviceId/eligible-providers` applies the
  structural eligibility rules.

The Prisma definitions and database constraints are in `prisma/schema.prisma`. The application
rules are implemented by the membership, service-provider, and service-catalog modules under
`src/`.
