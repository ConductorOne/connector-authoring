# Sources - read-authoring-contract

Read the tenant's MCP-served authoring guide at S0; it takes precedence over
static documentation. Tenant lifecycle behavior is read live, not inferred
from a public SDK release. Internal design discussion informed the resume
check; it is not a fetchable public source.

In-repo content is referenced by relative path and is always current with the checkout; skills and examples evolve in the same commit.

| Source | Public pin / access | What this skill uses |
|---|---|---|
| SDK declarations and examples | `../../baton/*.d.ts`, `../../examples/http/`, `../../examples/static/` (this checkout) | The `@baton/runtime`, `@baton/helpers`, and `@baton/types` module surface. |
| Historical SDK baseline | [v0.0.26](https://github.com/ConductorOne/connector-authoring/tree/v0.0.26) | Historical declaration release, not proof of compatibility with the current tenant runtime. |
| Tenant-served authoring guide | Read through `c1_connector_authoring_get_authoring_guide` | SDK discovery, `default_tag`, `runtime_pin_matched`, resume checks before creating a draft, and recording returned IDs. |

## Eval wiring

- The resume check before creating a draft is a skill-body assertion; the scorer's S1 gate does not enforce it.
- SDK-discovery and resume-check literals are enforced by `evals/runner/skills_bundle.test.ts`.
