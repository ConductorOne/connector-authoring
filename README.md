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

## Examples

[`examples/static`](./examples/static) is a neutral, configuration-free sync
example backed by hardcoded data. It demonstrates:

- user, group, and role resource types;
- resource traversal with `walk`;
- entitlements and grants from groups and roles to users; and
- the capabilities, configuration, and runtime schema files used by an
  authored connector.

The example does not call an external API or demonstrate configured
transports. Its purpose is to show the declaration surface and data model
without depending on an external system.

## Typechecking

Install the pinned development dependency and typecheck the static example
against the declarations:

```sh
npm ci
npm run typecheck
```
