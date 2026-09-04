---
name: design-access-model
description: Use when designing the access model (resource types, traits, entitlements, grants, provisioning scope) for a net-new provider before authoring connector source. Do not use when you are already mid-funnel or authoring source - invoke write-connector-source instead.
version: 0.1.0
---

# design-access-model

Use after `source-openapi-spec` (the spec is sourced and the IAM go/no-go gate passed) and before `write-connector-source`.

## Workflow

1. Map upstream entities to resource types and traits (table a).
2. Define stable resource IDs (stable-ID rules).
3. Define entitlements (slug, display name, grantable principals, stable ID shape).
4. Define grants (source map).
5. Decide sync-only vs provisionable (table b) with the mandatory justification.
6. Decide base-url config vs literal (table c).
7. Emit the output contract.

## Decision table (a) - trait selection

| Condition (upstream entity) | Decision (TRAIT_* const from `@baton/types`) | Mandatory justification sentence |
|---|---|---|
| Human user accounts (people with login credentials) | `TRAIT_USER` | "because the upstream entity is a human user account" |
| Groups / teams / directories of principals | `TRAIT_GROUP` | "because the upstream entity is a group of principals" |
| Roles / permission sets / policies | `TRAIT_ROLE` | "because the upstream entity is a role or permission set" |
| OAuth applications / API clients (app-user) | `TRAIT_APP` | "because the upstream entity is an application identity" |
| Service accounts / non-human identities | `TRAIT_APP` (or `TRAIT_SECRET` for static-credential NHIs) | "because the upstream entity is a non-human identity" |

## Decision table (b) - sync-only vs provisionable

| Condition (API surface) | Decision | Mandatory justification sentence |
|---|---|---|
| API exposes grant/revoke write ops (e.g. POST/DELETE membership endpoints) | provisionable (grant/revoke) | "because the API exposes the <op> write operation" |
| API exposes user/group create/update/delete | provisionable (account provisioning) | "because the API exposes the <op> write operation" |
| API lacks the write op for the resource or membership | sync-only | "because the API lacks <the missing op>" |

## Decision table (c) - base-url config vs literal

| Condition | Decision | Mandatory justification sentence |
|---|---|---|
| Multi-tenant / customer-owned base URL (per-tenant subdomain or region) | required config field `base-url` | "because the base URL is customer-owned and varies per tenant" |
| Single fixed endpoint (one global URL) | literal in source | "because the API has a single fixed endpoint" |

## Stable-ID rules

Never use display names, emails, or mutable slugs as IDs. Use the API's
immutable object id; composite IDs join stable parts.

## Handoffs

- Spec missing or the IAM go/no-go gate failed -> `source-openapi-spec`.
- Model done -> `write-connector-source`.

## Output Contract

Emit the `access_model` half of the pre1.json artifact:

- `resource_types`: list of `{id, traits}` pairs (one per upstream entity).
- `entitlements`: list of `{slug, display_name, grantable_principals, stable_id_shape}`.
- `grants`: list of `{resource_type, entitlement, principal_type}` edges.
- `id_compatibility`: table of `{resource_type, id_shape, stable}` rows.
- `provisioning`: list of `{resource_type, provisionable, justification}` rows.

## Eval-alignment contract

- `id_compatibility` must be non-empty.
- Every `provisioning` entry must carry a non-empty `justification`.

## Exit criteria

- Every upstream entity mapped to a resource type with a trait from table (a).
- Every entitlement has a slug, display name, grantable principals, and stable ID shape.
- Every grant edge has a source in the API.
- Every provisioning decision carries the mandatory justification sentence.
- The base-url decision is justified from table (c).

## Anti-patterns

- `WithExternalID is DEPRECATED - never required`.
- Do not use display names, emails, or mutable slugs as stable IDs.
- Do not add every available endpoint to the connector model.
- Do not mark a resource provisionable when the API lacks the write op.

## Blocker protocol

If the same validation or runtime error remains unchanged after 2 failed fix
cycles on the same error, stop and report the exact error text instead of
guessing further.
