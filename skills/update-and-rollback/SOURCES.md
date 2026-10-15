# Sources - update-and-rollback

Read the tenant's MCP-served authoring guide at S0; it takes precedence over
static documentation. Internal design discussion informed the update and
rollback boundaries; it is not a fetchable public source.

In-repo content is referenced by relative path and is always current with the checkout; skills and examples evolve in the same commit.

| Source | Public pin / access | What this skill uses |
|---|---|---|
| SDK declarations and examples | `../../baton/*.d.ts`, `../../examples/http/`, `../../examples/static/` (this checkout) | The `baton/*.d.ts` module surface used to author a replacement revision. |
| Historical SDK baseline | [v0.0.26](https://github.com/ConductorOne/connector-authoring/tree/v0.0.26) | Historical declaration release, not proof of compatibility with the current tenant runtime. |
| Tenant-served authoring guide and connector status | Read the guide and `c1_connector_service_get` | Image-digest reuse rule, fresh accepted PASS evidence, human-only activation, activation epoch, one verification sync, rotation STOP, and OWNER-gated REST rollback. |

## Eval wiring

- Rotation errors, rollback request fields, activation evidence, terminal sync statuses, and the single verification-sync policy are enforced by `evals/runner/skills_bundle.test.ts`.
