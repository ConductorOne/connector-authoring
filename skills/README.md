# Agent skills

The ten skills shipped in this batch: the five funnel skills and two
pre-1 skills authored against the DSL contract and the 26-tool tenant MCP surface; validated by the eval suite, plus three post-funnel and cross-cutting skills
(`verify-connector-output`, `update-and-rollback`,
`diagnose-authoring-failure`) over the tenant connector and authoring
tool surface. Each skill's `SOURCES.md` distinguishes checkout-relative
declarations and examples from the tenant-served guide and generic design provenance.

Skills ship to the hosted in-app agent through vendoring. They are reference,
not a C1 API contract, for BYO/external agents: read the tenant-served guide and
tool descriptions first. Examples serve both audiences; fetch examples and
declarations together at the exact runtime-compatible release tag returned by
`get_sdk_types`, or a reviewed commit. A public example's local checks do not
establish compatibility with every hosted runtime.

| Skill | Stage coverage | Source basis |
|---|---|---|
| `author-in-app-connector` | Orchestrator — the full S0–S11 funnel | MCP-served guide, `authoring.proto` |
| `read-authoring-contract` | Stage 0 — guide + SDK contract read | MCP-served guide, `authoring.proto` |
| `write-connector-source` | Source authoring before S2 - the four build-required files plus the two test-required frozen files (`openapi.json`, `reviewed-ops.json`) | MCP-served guide, public SDK declarations and examples |
| `build-and-test` | Stages 2–5, 9–10 — upload, build, draft test | MCP-served guide, `authoring.proto` |
| `deploy-and-activate` | Stages 6–8, 11 — app, provision, configure, deploy, mint, handoff | MCP-served guide, `authoring.proto` |
| `design-access-model` | Pre-1 - access-model design for net-new providers | Public SDK traits/examples, internal design discussion |
| `source-openapi-spec` | Pre-1 - OpenAPI spec sourcing + IAM go/no-go | Provider documentation, internal design discussion |
| `verify-connector-output` | Post-11 - counts/type checks; per-record resolution and ID stability NOT VERIFIED without owner evidence | MCP-served guide, public SDK examples, internal design discussion |
| `update-and-rollback` | Post-activation - same-catalog update + owner-only linked rollback | MCP-served guide, `authoring.proto` |
| `diagnose-authoring-failure` | Cross-cutting - symptom -> cause -> fix router | MCP-served guide, public SDK examples, internal design discussion |

The eval bundle (`evals/skills-bundle/bundle.json`) is a manifest pointing
into this directory; the skill bodies live here as the single source of
truth.

## Stage equivalence

The S0-S11 labels are checklist steps, not competing runtime stages. The served
guide's stage map controls ordering and gates:

| Served stage | Skill/checklist equivalent |
|---|---|
| SCOPE | S0 `read-authoring-contract`, pre-1 spec sourcing and access-model design; confirm operations/auth/scopes |
| SKELETON-BUILD | S1 draft; `write-connector-source`; S2-S5 upload/review/build for exactly one projection |
| CONNECT | S6-S8 app/provision/credentials after skeleton build |
| SKELETON-TEST | First S9-S10 draft test and evidence gate |
| EXPAND | Repeat source/review/S2-S5/S9-S10 for the remaining confirmed scope |
| DEPLOY + HANDOFF | S11 deploy/mint; stop for human OWNER activation |
| VERIFY | After owner activation, one verification sync and `verify-connector-output`; subsequent syncs are human-owned |


## Eval evidence

The measurable evidence for these skills is the deterministic, committed,
executable eval harness in `evals/`:

- **Tier-0 scored replay** — `npm run eval:run -- --scenario evals/scenarios/tier1-directory.json --driver tier0` replays a committed scenario end-to-end against the local fixture and produces a scored JSONL record of the full S0–S11 funnel (no credentials, no network beyond localhost).
- **Unit smokes** — `npm run eval:test` runs the committed scorer/parser/stages/record/scenario/driver tests.
- **Scorer + fixture harness** — `evals/runner/score.ts` and `evals/fixture/` are the deterministic scoring and fixture layers the replay exercises.

The committed `evals/results/baseline.json` summarizes historical real-tenant
runs. This repository ships only the Tier-0 local driver, not the driver or
per-run records needed to reproduce that baseline. See `evals/README.md`
for the measured results and their caveats.
