# Sources - verify-connector-output

Read the tenant's MCP-served authoring guide at S0; it takes precedence over
static documentation. Internal design discussion informed the verification
inventory; it is not a fetchable public source.

In-repo content is referenced by relative path and is always current with the checkout; skills and examples evolve in the same commit.

| Source | Public pin / access | What this skill uses |
|---|---|---|
| SDK declarations and examples | `../../baton/*.d.ts`, `../../examples/http/`, `../../examples/static/` (this checkout) | Resource, entitlement, and grant shapes and stable-ID mappings in `baton/*.d.ts` and `examples/`. |
| Historical SDK baseline | [v0.0.26](https://github.com/ConductorOne/connector-authoring/tree/v0.0.26) | Historical declaration release, not proof of compatibility with the current tenant runtime. |
| Tenant-served authoring guide and connector status | Read the guide and `c1_connector_service_get` | Production-sync verification, terminal status, sync-disabled reasons, intended scope, grant wiring, and UI verification. |

## Eval wiring

- The verification inventory checks per-resource-type counts against the live API and ID stability across re-sync; never invent data to complete a demo.
- Status, grant-wiring, ID-stability, and UI-path literals are enforced by `evals/runner/skills_bundle.test.ts`.
