# Sources - diagnose-authoring-failure

Read the tenant's MCP-served authoring guide at S0; it takes precedence over
static documentation. Internal design discussion informed the symptom-first
taxonomy and evidence/owner/fix/rerun handoff; it is not a fetchable public
source.

In-repo content is referenced by relative path and is always current with the checkout; skills and examples evolve in the same commit.

| Source | Public pin / access | What this skill uses |
|---|---|---|
| SDK declarations and examples | `../../baton/*.d.ts`, `../../examples/http/` (this checkout) | `baton/*.d.ts` and `examples/http` for config, transport, and source-shape diagnostics. |
| Historical SDK baseline | [v0.0.26](https://github.com/ConductorOne/connector-authoring/tree/v0.0.26) | Historical declaration release, not proof of compatibility with the current tenant runtime. |
| Tenant-served authoring guide and connector status | Read the guide, test evidence, and `c1_connector_service_get` | Compile/bundle caps, credential re-entry, durable evidence and verdicts, common failures, `ConnectionOK`/`HostCallOK`, status errors, and product activity/sync logs. |

## Eval wiring

- Common-failure messages, evidence checks, and status fields are enforced by `evals/runner/skills_bundle.test.ts`.
