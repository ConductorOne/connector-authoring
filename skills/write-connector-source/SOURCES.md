# Sources - write-connector-source

Read the tenant's MCP-served authoring guide at S0; it takes precedence over
static documentation. Internal design discussion informed the source-file
contract, capability validation, config handling, and runtime pitfalls; it is
not a fetchable public source.

In-repo content is referenced by relative path and is always current with the checkout; skills and examples evolve in the same commit.

| Source | Public pin / access | What this skill uses |
|---|---|---|
| SDK declarations and examples | `../../baton/*.d.ts`, `../../examples/http/`, `../../examples/static/` (this checkout) | `baton/*.d.ts` for connector graphs, opaque config references, transport registration, slot identity, user helpers, and pagination; `examples/{static,http}` for source/config/capability shapes. |
| Historical SDK baseline | [v0.0.26](https://github.com/ConductorOne/connector-authoring/tree/v0.0.26) | Historical declaration release, not proof of compatibility with the current tenant runtime. |
| Tenant-served authoring guide | Read through `c1_connector_authoring_get_authoring_guide` | Required files, entrypoint precedence, dual config schemas, credential secrecy, compile/bundle limits, frozen operation declarations, and activation evidence. |
| Public capabilities example | `../../examples/http/capabilities.json` | The `connectorCapabilities` / `resourceTypeCapabilities` proto-JSON shape; capability metadata does not grant runtime transport authority. |

## Eval wiring

- Source checks cover scoped list calls, nullable fields, total-count pagination, dual-schema config declarations, user construction, and source hygiene.
- Capability and config guardrails are enforced by `evals/runner/skills_bundle.test.ts`.
