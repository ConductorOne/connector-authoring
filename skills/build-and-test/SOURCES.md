# Sources - build-and-test

Read the tenant's MCP-served authoring guide at S0; it takes precedence over
static documentation. Tenant lifecycle behavior is read live, not inferred
from a public SDK release. Internal design discussion informed the evidence
boundaries; it is not a fetchable public source.

In-repo content is referenced by relative path and is always current with the checkout; skills and examples evolve in the same commit.

| Source | Reference | What this skill uses |
|---|---|---|
| SDK declarations and examples | `../../baton/*.d.ts`, `../../examples/http/`, `../../examples/static/` (this checkout) | `baton/*.d.ts` and the source files uploaded for build and test. |
| Tenant-served authoring guide | Read through `c1_connector_authoring_get_authoring_guide` | Upload targets and signed headers, size caps, required files, build state, durable test evidence, operation review, and transport verdicts. |

## Eval wiring

- The fixture records the draft-test result as `"PASS"`; the real surface returns `CONNECTOR_TEST_RUN_RESULT_PASS`. The scorer's S10 gate checks the fixture string, not transport judgment or activation eligibility.
- External-provenance drafts stop at S10 on `owner_judgment_required`; the fixture replay does not model human evidence acceptance.
- Required-file, upload, build, and test literals are enforced by `evals/runner/skills_bundle.test.ts`.
