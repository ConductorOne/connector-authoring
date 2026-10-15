# Sources - verify-connector-output

Read the tenant's MCP-served authoring guide at S0; it takes precedence over
static documentation. Internal design discussion informed the verification
inventory; it is not a fetchable public source.

| Source | Public pin / access | What this skill uses |
|---|---|---|
| SDK declarations and examples | [connector-authoring at 8c5d8bd](https://github.com/ConductorOne/connector-authoring/tree/8c5d8bd1e48fbdb2e1502420cdf3d7939fb1010d) | Resource, entitlement, and grant shapes and stable-ID mappings in `baton/*.d.ts` and `examples/`. |
| Historical SDK baseline | [v0.0.26](https://github.com/ConductorOne/connector-authoring/tree/v0.0.26) | Historical declaration release, not proof of compatibility with the current tenant runtime. |
| Tenant-served authoring guide and connector status | Read the guide and `c1_connector_service_get` | Production-sync verification, terminal status, sync-disabled reasons, intended scope, grant wiring, and UI verification. |

## Eval wiring

- The verification inventory checks per-resource-type counts against the live API and ID stability across re-sync; never invent data to complete a demo.
- Status, grant-wiring, ID-stability, and UI-path literals are enforced by `evals/runner/skills_bundle.test.ts`.
