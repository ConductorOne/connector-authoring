# Sources - author-in-app-connector

Read the tenant's MCP-served authoring guide at S0; it takes precedence over
static documentation. Tenant lifecycle behavior is read live, not inferred
from a public SDK release. Internal design discussion informed the stage
boundaries; it is not a fetchable public source.

| Source | Public pin / access | What this skill uses |
|---|---|---|
| SDK declarations and examples | [connector-authoring at 8c5d8bd](https://github.com/ConductorOne/connector-authoring/tree/8c5d8bd1e48fbdb2e1502420cdf3d7939fb1010d) | `baton/*.d.ts` and `examples/` for the source files authored during the funnel. |
| Historical SDK baseline | [v0.0.26](https://github.com/ConductorOne/connector-authoring/tree/v0.0.26) | Historical declaration release, not proof of compatibility with the current tenant runtime. |
| Tenant-served authoring guide | Read through `c1_connector_authoring_get_authoring_guide` | Lifecycle order, required files, returned IDs, evidence gates, and human-only activation. |

## Eval wiring

- S2 is the full upload dance (create upload, PUTs, finalize); S3 checks the required files. Re-running S2 repeats the full upload dance.
- The fixture run stops at the human handoff and does not simulate activation notifications or post-activation verification. Its scorer rejects sync calls in that pre-activation transcript.
- The scorer records S11b/S11c as `skipped_human_boundary`; a real session resumed after activation performs one verification sync, then hands subsequent syncs to the human/operator.
- Handoff fields and activation boundaries are enforced by `evals/runner/skills_bundle.test.ts`.
