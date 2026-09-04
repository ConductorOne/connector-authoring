---
name: write-connector-source
description: Use when authoring the four-file source contract (connector.ts, config-schema.json, runtime-schema.json, capabilities.json) for an in-app connector draft, before the S2 upload. Do not use when the source files are already uploaded and you are mid-funnel - invoke build-and-test instead.
version: 0.2.0
---

# write-connector-source

This skill authors the four-file source contract for the in-app connector
draft; the orchestrator invokes it after S1 (create_draft) and before S2
(upload). The served guide read at S0 is the contract - served-guide-wins
rule: when the served guide conflicts with any other doc, the served guide wins.

## The four-file contract

| File | Required | Rules |
|------|----------|-------|
| `connector.ts` | yes | Root or `src/connector.ts` (root wins); default-exported `connector({...})` from `@baton/runtime`; declarative graph only - no `fetch`, no hand pagination, no secret handling; every referenced transport registered under `transports:`. |
| `config-schema.json` | yes | baton Configuration document `{"fields":[...]}` with `stringField`/`boolField`/`intField` - NOT JSON Schema; secret spellings `is_secret`/`isSecret`/`IsSecret`. |
| `runtime-schema.json` | yes | Inline `runtime.config_schema`; every field carries `type`; credential-class fields `is_secret: true`; `runtime.connector: "connector.js"`. |
| `capabilities.json` | yes | The `c1.connector.v2.ConnectorCapabilities` contract (see the capabilities section below). |

## connector.ts rules

1. Config refs are opaque at module eval - `ref || default` never fires for
   transports; make the field required or resolve at request time.
2. Every transport referenced by a `node` or `reuse` must be the SAME
   transport object registered under `transports:` in the default export.
3. Slot identity is by JS reference - never re-call `slot()`.
4. The bundle targets ES5 - no `u` regex flag; goja quirks apply.
5. Import only from `@baton/runtime`, `@baton/types`, `@baton/helpers`
   (`@baton/*` resolution).

Worked skeletons: read `examples/http/connector.ts` (transport + offset
pagination + users/groups/membership grants), `examples/static/connector.ts`
(zero-config), and the lifecycle doc's "Worked example: Okta read-only connector" section (pin in SOURCES.md) as the patterns to follow.

## config-schema.json rules

The baton Configuration document shape - `{"fields":[...]}` with
`stringField`/`boolField`/`intField` entries; do NOT paste a plain JSON
Schema (rejected at draft time); secret fields use
`is_secret`/`isSecret`/`IsSecret` spellings. Example shape (from the
lifecycle doc's source-file contract section):

```json
{
  "displayName": "My Connector",
  "fields": [
    {
      "name": "base-url",
      "displayName": "Base URL",
      "description": "The base URL of the service.",
      "isRequired": true,
      "stringField": { "rules": { "isRequired": true } }
    },
    {
      "name": "api-token",
      "displayName": "API token",
      "isRequired": true,
      "isSecret": true,
      "stringField": { "rules": { "isRequired": true } }
    }
  ]
}
```

## runtime-schema.json rules

The runtime contract with the baton `config_schema` inlined (do not fold the
UI schema in - it is the wrong shape); EVERY field in the inline
`config_schema` carries `type` (missing `type` is a runtime initialization
error); credential-class fields (names containing `token`, `secret`,
`password`, `api-key`, and similar) MUST carry `is_secret: true` - the build
rejects a credential-class field not marked secret; the `secret:` spelling
is not read; `runtime.connector: "connector.js"`. Example shape (from the
lifecycle doc's source-file contract section):

```json
{
  "version": 1,
  "name": "my-connector",
  "runtime": {
    "connector": "connector.js",
    "config_schema": {
      "display_name": "My Connector",
      "fields": [
        {
          "name": "base-url",
          "type": "string",
          "required": true,
          "description": "The base URL of the service.",
          "display_name": "Base URL"
        },
        {
          "name": "api-token",
          "type": "string",
          "required": true,
          "is_secret": true,
          "description": "The API token.",
          "display_name": "API token"
        }
      ]
    }
  }
}
```

## capabilities.json

The file is the `c1.connector.v2.ConnectorCapabilities` contract - proto
JSON with `connectorCapabilities` and `resourceTypeCapabilities[]`, each
entry `resourceType{id,displayName,traits}` + `capabilities[]`;
per-resource-type traits/annotations; capability enum values
`CAPABILITY_SYNC`/`CAPABILITY_PROVISION`/`CAPABILITY_ACCOUNT_PROVISIONING`.
NOT a placeholder. Generation path: compiled connector + image-baked
`baton-axiomatic capabilities` with safe placeholder config (shopify
Makefile pattern: `env BATON_BASE_URL=https://placeholder.myshopify.com
BATON_TOKEN=placeholder BATON_CONFIG=<config> baton-axiomatic capabilities >
baton_capabilities.json`; capability generation never makes network calls).
Move the output to `capabilities.json` - the four-file contract name (shopify writes `baton_capabilities.json`).
The in-app build today requires presence/non-empty only and does not
schema-validate the file; the shipped `examples/{static,http}/capabilities.json` files carry this exact shape and are the quoted form:

```json
{
  "connectorCapabilities": ["CAPABILITY_SYNC"],
  "resourceTypeCapabilities": [
    {
      "resourceType": {
        "id": "user",
        "displayName": "User",
        "traits": ["TRAIT_USER"]
      },
      "capabilities": ["CAPABILITY_SYNC"]
    },
    {
      "resourceType": {
        "id": "group",
        "displayName": "Group",
        "traits": ["TRAIT_GROUP"]
      },
      "capabilities": ["CAPABILITY_SYNC"]
    }
  ]
}
```

## Dual-schema parity (pre-upload checklist)

Field-name parity between `config-schema.json` and `runtime-schema.json`;
`api-token` `is_secret` in BOTH schemas. Pass/fail checks from the docs'
common-failures table:

- [ ] `connector.ts` source under the 262144-byte compile limit.
- [ ] Bundle with embedded runtime specs under the 1048576-byte limit.
- [ ] Every credential-class config field marked `is_secret` (build rejects
      `credential-class config field must be marked is_secret`).
- [ ] Every `connector config field X is missing type` fixed - `type` on
      every field.
- [ ] No unregistered transport - every transport referenced by a `node` or
      `reuse` registered under `transports:`.
- [ ] Every `config("...")` literal in `connector.ts` declared in BOTH
      schemas (parity covers connector.ts config refs, not just the two schemas).
- [ ] `ticketing.enabled` - no `ticketing` block the connector code does not back (`ticketing.enabled must be true when ticketing is configured`).

## Eval-alignment contract

Taught as contract rules, not eval-gaming literals:

- Scope list calls - the users list-call query must pass `account_id`
  structurally (a comment mention does not count).
- Handle nullable fields - `user.title` may be null; project defensively.
- Terminate offset pagination with `totalPath`.
- Use the three config literals `config("base-url")` / `config("account-email")` / `config("api-token")`.
- Construct users with `newUserResource` + `user.id`.
- Hygiene: all four files present; dual-schema field-name parity; `api-token` `is_secret` in both schemas; the literal `fixture-token` in NO uploaded file; bundle caps (16 MiB total / 12 MiB per file / 256 files).

## Exit criteria

- All four files authored per the contract above.
- Dual-schema parity holds.
- `capabilities.json` carries the ConnectorCapabilities shape.
- The body contains the locked literals listed in the bundle test.

## Anti-patterns

- Do not call fetch - declare the graph; the hosted runtime owns execution.
- Do not paste JSON Schema into `config-schema.json`.
- Do not use the secret: spelling - use `is_secret`.
- WithExternalID is DEPRECATED - never required.
- Do not write plaintext secrets into `connector.ts`.
- Do not claim the build schema-validates `capabilities.json`.

## Blocker protocol

If the same validation or runtime error remains unchanged after 2 failed fix
cycles on the same error, stop and report the exact error text instead of
guessing further.
