# Sources - deploy-and-activate

Read the tenant's MCP-served authoring guide at S0; it takes precedence over
static documentation. Tenant lifecycle behavior is read live, not inferred
from a public SDK release. Internal design discussion informed the human
boundary; it is not a fetchable public source.

In-repo content is referenced by relative path and is always current with the checkout; skills and examples evolve in the same commit.

| Source | Public pin / access | What this skill uses |
|---|---|---|
| SDK declarations and examples | `../../baton/*.d.ts`, `../../examples/http/config-schema.json` (this checkout) | `baton/*.d.ts`, `examples/http/config-schema.json`, and transport config references. |
| Historical SDK baseline | [v0.0.26](https://github.com/ConductorOne/connector-authoring/tree/v0.0.26) | Historical declaration release, not proof of compatibility with the current tenant runtime. |
| Tenant-served authoring guide | Read through `c1_connector_authoring_get_authoring_guide` | Provisioning, credential configuration, approval lifetime, deployment, human-only activation, ACTIVE status, and verification sync. |

## Eval wiring

- The fixture scorer checks the directory example's credentials; other providers use their own `config-schema.json` fields.
- The fixture run ends at the human handoff; its S11 gate rejects calls after mint other than the handoff write. It does not simulate activation notifications or post-activation verification.
- The scorer records S11b/S11c as `skipped_human_boundary`; a real session resumed after activation performs one verification sync, then hands subsequent syncs to the human/operator.
- Handoff fields and activation boundaries are enforced by `evals/runner/skills_bundle.test.ts`.
