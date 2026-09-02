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

## Declarative execution model

```text
config + auth -> registered transport -> node outputs/slots -> walk mappings
              -> resource types (resources, entitlements, grants)
```

Authored TypeScript declares a graph. `http.v1(...)` declares a transport,
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
- [`examples/http`](./examples/http) is a compile-only fictional Directory API
  example. It demonstrates public and secret config, basic authentication,
  transport registration, offset pagination, nodes, slots, users, groups, a
  membership entitlement, and grants. See its
  [documented response contract](./examples/http/README.md).

Neither example calls a live service as part of this repository's checks.

## Evals

[`evals`](./evals) contains the scenario-driven eval harness for agent-driven
connector authoring: a runner that provisions fresh c1-image Squire
environments, a deterministic scorer for the authoring lifecycle's stage
funnel, JSONL run records, and the Tier-1 fixture provider (a deterministic
"Directory API" container extended from `examples/http`). See the
[evals README](./evals/README.md).

## Typechecking

Install the pinned development dependency and typecheck the examples against
the declarations:

```sh
npm ci --ignore-scripts --audit=false --fund=false
npm run typecheck
```
