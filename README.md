# connector-authoring

Public TypeScript declarations and examples for ConductorOne connector
authoring.

## Type declarations

The [`baton`](./baton) directory declares the modules available to authored
connectors:

- [`@baton/runtime`](./baton/runtime.d.ts) defines the connector runtime,
  resource-type, traversal, and transport APIs.
- [`@baton/helpers`](./baton/helpers.d.ts) defines helpers for constructing
  identifiers, annotations, and common connector values.
- [`@baton/types`](./baton/types.d.ts) defines connector resources,
  entitlements, grants, traits, and related data types.

These files contain declarations only. Runtime implementations are provided by
the hosted ConductorOne product; connector source imports the modules but does
not bundle their implementations. This repository does not by itself establish
compatibility with a particular hosted runtime.

## Tags and consumer pins

- `v0.0.x` tags are runtime/types releases published by the sync pipeline.
  These release tags are immutable; consumers address their content by the
  resolved commit.
- The floating `v0` tag is retired. Its only consumer, ConductorOne's skill
  vendoring, now tracks `main`.
- `v0.1.0` is a retired early skills-milestone tag, not the latest runtime/types
  bundle.

Pin exact release tags for declarations. Track `main` for skills.

## Declarative execution model

```text
config + auth -> registered transport -> node outputs/slots -> walk mappings
              -> resource types (resources, entitlements, grants)
```

Authored TypeScript declares a graph. `http.v2(...)` declares a transport,
`node.run` returns an execution descriptor, slots carry returned rows, and
`walk` maps those rows into ConductorOne values. The hosted runtime owns
execution and pagination.

Config and authentication values remain opaque references that the hosted
runtime resolves. Connector code must not inspect or log secret values. Do not
use direct `fetch` calls or hand-written pagination loops in authored code.

## Examples

- [`examples/static`](./examples/static) is a neutral, configuration-free sync
  example backed by hardcoded data. It demonstrates local resource,
  entitlement, and grant mappings without transport, authentication, or
  pagination.
- [`examples/http`](./examples/http) is a fictional Directory API
  example. It demonstrates public and secret config, basic authentication,
  transport registration, offset pagination, nodes, slots, users, groups, a
  membership entitlement, and grants. See its
  [documented response contract](./examples/http/README.md).
- [`examples/oauth-client-credentials`](./examples/oauth-client-credentials)
  demonstrates one base-URL input with derived OAuth token URL and audience,
  retaining a bare config reference for serve-time host derivation.

The examples' local checks do not call a live service. The HTTP and OAuth
READMEs separately record their prepared-provider dev-tenant build/draft-test validation.
Examples serve hosted and BYO authors; fetch examples and declarations together
at the exact runtime-compatible release tag, or a reviewed commit. Never assume
a current-main example is compatible with an older hosted runtime.

## Agent skills

The [`skills`](./skills) directory ships agent skills for the in-app
connector authoring funnel: `author-in-app-connector` (the S0–S11
orchestrator), `read-authoring-contract`, `write-connector-source` (the
four build-required files plus the two test-required frozen files
(`openapi.json`, `reviewed-ops.json`) authoring stage), `build-and-test`, and
`deploy-and-activate`. Each skill's `SOURCES.md` names the pinned contract
sources it was authored against.
Skills are shipped for the hosted in-app agent. BYO/external agents may browse
them as reference, not as a C1 contract; the tenant-served authoring guide and
tool descriptions remain authoritative. Examples alone do not reach the hosted
agent, so required authoring patterns are also stated in the skills.

## Typechecking

Install the pinned development dependency and typecheck the examples against
the declarations:

```sh
npm ci --ignore-scripts --audit=false --fund=false
npm run typecheck
```

The declarations themselves are checked strictly (no `skipLibCheck`), both with
the pinned `tsc` and with Deno 2.9.x against the per-module layout the hosted
product serves (`@baton/<module>/index.d.ts` plus sibling declarations):

```sh
npm run typecheck:decl
npm run typecheck:parity
```
