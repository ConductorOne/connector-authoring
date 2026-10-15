---
name: write-connector-source
description: Use when authoring the four build-required files (connector.ts, config-schema.json, runtime-schema.json, capabilities.json) plus the two test-required frozen files (openapi.json, reviewed-ops.json) for an in-app connector draft, before the S2 upload. Do not use when the source files are already uploaded and you are mid-funnel - invoke build-and-test instead.
version: 0.2.3
---

# write-connector-source

This skill authors four build-required files plus two test-required frozen files
(`openapi.json`, `reviewed-ops.json`) after S1, before S2.
The S0 served guide wins on conflict with other docs.

## The source-file contract

| File | Required | Rules |
|------|----------|-------|
| `connector.ts` | build | Root or `src/connector.ts` (root wins); default-exported `connector({...})` from `@baton/runtime`; declarative graph only - no `fetch`, no hand pagination, no secret handling; every referenced transport registered under `transports:`. |
| `config-schema.json` | build | baton Configuration document `{"fields":[...]}` with `stringField`/`boolField`/`intField` - NOT JSON Schema; secret spellings `is_secret`/`isSecret`/`IsSecret`. |
| `runtime-schema.json` | build | Inline `runtime.config_schema`; every field carries `type`; credential-class fields `is_secret: true`; `runtime.connector: "connector.js"`. |
| `capabilities.json` | build | A `c1.connector.v2.ConnectorCapabilities` proto-JSON document (the `baton-axiomatic capabilities` output, with or without its `@type` line) with a non-empty `connectorCapabilities` list; the build rejects any other shape. Metadata only - it grants nothing at runtime (see below). |
| `openapi.json` | optional for build; required for PASS/activation | Frozen OpenAPI document covering the connector's read endpoints. |
| `reviewed-ops.json` | optional for build; required for PASS/activation | Frozen typed object with `operations[]`: `operation_id`, `method`, `path_template`, `read`, `id_path`, `output_slice`, and `pagination` as an object with camelCase keys (e.g. `{"style":"offset","pageParam":"offset","sizeParam":"limit"}`). |

Every projection needs `output_slice`: a dot-path (e.g. `"items"`) or `""` for a root array.
Omitting it declares no projection. A child's
`parent: {"operation_id":"groups","id_path":"id","param":"groupId"}` needs matching
`{groupId}` in `path_template`. Use camelCase pagination; see `examples/http`.

Top-level `connect` (sibling of `runtime`, `{"<transport-name>": {"type": "http"}}`) is not a build requirement and the hosted runtime does not read it as a transport source - transports come from `transports:` in `connector.ts`. It is a C1-side contract: the draft-test probe derives the default transport for `reviewed-ops.json` from its single `http` entry (probe setup fails with `reviewed operations declarations are invalid` without it), and C1 derives the runtime's host transport grants from its kinds. Keep exactly one `http` entry named after the registered transport; `ldap`/`sql` are rejected at admission.

## connector.ts rules

1. Config refs are opaque at module eval - `ref || default` never fires for transports; make the field required or resolve at request time.
2. Every transport referenced by a `node` or `reuse` must be the SAME transport object registered under `transports:` in the default export.
3. Slot identity is by JS reference - never re-call `slot()`.
4. The bundle targets ES5 - no `u` regex flag; goja quirks apply.
5. Import only from `@baton/runtime`, `@baton/types`, `@baton/helpers` (`@baton/*` resolution).

Worked skeletons: `examples/http/connector.ts` (transport + offset pagination + users/groups/membership grants) and `examples/static/connector.ts` (zero-config); see the public declaration pin in SOURCES.md.

## config-schema.json rules

The baton Configuration document shape - `{"fields":[...]}` with `stringField`/`boolField`/`intField` entries; do NOT paste a plain JSON Schema (rejected at draft time); secret fields use `is_secret`/`isSecret`/`IsSecret` spellings. Example shape:

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
UI schema in - it is the wrong shape); EVERY field carries `type` (missing
`type` is a runtime initialization error); credential-class fields (names
containing `token`, `secret`, `password`, `api-key`, and similar) MUST carry
`is_secret: true` - the build rejects a credential-class field not marked
secret; the `secret:` spelling is not read; `runtime.connector: "connector.js"`.
Top-level `connect` uses the registered transport name: `directory` for
`const directory = http.v1(...)` and `transports: {directory}`; HTTP uses `"type": "http"`.
Example shape (from the lifecycle doc's source-file contract section):

```json
{
  "version": "1",
  "name": "my-connector",
  "connect": { "directory": { "type": "http" } },
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

The file should describe the `c1.connector.v2.ConnectorCapabilities` contract:
proto JSON with `connectorCapabilities` and `resourceTypeCapabilities[]`, each
entry `resourceType{id,displayName,traits}` + `capabilities[]`; per-resource-type
traits/annotations; enum values `CAPABILITY_SYNC`/`CAPABILITY_PROVISION`/`CAPABILITY_ACCOUNT_PROVISIONING`.
The build validates this document strictly: proto JSON with a non-empty
`connectorCapabilities` list, optional
`@type: type.googleapis.com/c1.connector.v2.ConnectorCapabilities` envelope,
no unknown fields; bool maps or placeholders are rejected. It is metadata only -
host transport grants are derived from the sealed transport declarations, never
from this file. Hand-author the `examples/http/capabilities.json` shape below.
The `baton-axiomatic capabilities` generation
path (shopify Makefile: `env BATON_BASE_URL=https://placeholder.myshopify.com
BATON_TOKEN=placeholder BATON_CONFIG=<config> baton-axiomatic capabilities >
baton_capabilities.json`; never makes network calls) applies only when a compiled
connector image is available; move its output to `capabilities.json`.

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
`api-token` `is_secret` in BOTH schemas. Pass/fail checks from the docs' common-failures table:

- [ ] `connector.ts` source under the 262144-byte compile limit.
- [ ] Built bundle with embedded runtime specs under the 1048576-byte limit (see `build-and-test`).
- [ ] Every credential-class config field marked `is_secret` (build rejects
      `credential-class config field must be marked is_secret`).
- [ ] Every `connector config field X is missing type` fixed - `type` on
      every field.
- [ ] No unregistered transport - every transport referenced by a `node` or
      `reuse` registered under `transports:`.
- [ ] Top-level `connect` present with one `http` entry named after the
      registered transport (draft-test probe default; not read by the runtime).
- [ ] `openapi.json` + `reviewed-ops.json` present with `output_slice` on every
      projection before draft testing.
- [ ] Every `config("...")` literal in `connector.ts` declared in BOTH schemas (parity covers config refs, not just the two schemas).
- [ ] `ticketing.enabled` - no unsupported `ticketing` block (`ticketing.enabled must be true when ticketing is configured`).

## Contract rules

- Scope list calls with the tenant-scoping query param (e.g. `account_id`); a comment mention does not count.
- Handle nullable fields (e.g. `user.title`) defensively.
- Terminate offset pagination with the API's total-count path (`totalPath`).
- Declare every `config("...")` literal the code reads in BOTH schemas (e.g. `config("base-url")` / `config("account-email")` / `config("api-token")`).
- Construct users with the runtime's user helper + the user id (e.g. `newUserResource` + `user.id`).
- Hygiene: four build-required files; two frozen files for PASS/activation; dual-schema parity; `api-token` `is_secret` in both schemas; no fixture/test credentials in source; upload caps (16 MiB total / 12 MiB per file / 256 files).

## Exit criteria

- All four build-required files and both frozen files authored per the contract.
- Dual-schema parity holds; `capabilities.json` carries the ConnectorCapabilities shape.

## Anti-patterns

- Do not call fetch - declare the graph; the hosted runtime owns execution.
- Do not paste JSON Schema into `config-schema.json`. Do not use the secret: spelling; use `is_secret`.
- WithExternalID is DEPRECATED - never required.
- Do not write plaintext secrets into `connector.ts`.
- Do not treat `capabilities.json` as runtime authority or as a placeholder -
  it is strictly validated metadata.

## Blocker protocol

If the same validation or runtime error remains unchanged after 2 failed fix
cycles on the same error, stop and report the exact error text instead of
guessing further.
