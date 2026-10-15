# Agent skills

The ten skills shipped in this batch: the five funnel skills and two
pre-1 skills authored against the v0.0.26 DSL contract and the 25-tool tenant MCP surface; validated by the eval suite, plus three post-funnel and cross-cutting skills
(`verify-connector-output`, `update-and-rollback`,
`diagnose-authoring-failure`) over the tenant connector and authoring
tool surface. Each skill's `SOURCES.md` distinguishes public declaration
pins from the tenant-served guide and generic design provenance.

| Skill | Stage coverage | Source basis |
|---|---|---|
| `author-in-app-connector` | Orchestrator — the full S0–S11 funnel | MCP-served guide, `authoring.proto`, lifecycle doc |
| `read-authoring-contract` | Stage 0 — guide + SDK contract read | MCP-served guide, `authoring.proto` |
| `write-connector-source` | Source authoring before S2 - the four build-required files plus the two test-required frozen files (`openapi.json`, `reviewed-ops.json`) | MCP-served guide, public SDK declarations and examples |
| `build-and-test` | Stages 2–5, 9–10 — upload, build, draft test | MCP-served guide, `authoring.proto`, lifecycle doc |
| `deploy-and-activate` | Stages 6–8, 11 — app, provision, configure, deploy, mint, handoff | MCP-served guide, `authoring.proto`, lifecycle doc |
| `design-access-model` | Pre-1 - access-model design for net-new providers | Public SDK traits/examples, internal design discussion |
| `source-openapi-spec` | Pre-1 - OpenAPI spec sourcing + IAM go/no-go | Provider documentation, internal design discussion |
| `verify-connector-output` | Post-11 - post-sync verification (counts, grant wiring, ID stability, UI spot-check) | MCP-served guide, public SDK examples, internal design discussion |
| `update-and-rollback` | Post-activation - same-catalog update + REST rollback | MCP-served guide, `authoring.proto`, lifecycle doc |
| `diagnose-authoring-failure` | Cross-cutting - symptom -> cause -> fix router | MCP-served guide, public SDK examples, internal design discussion |

The eval bundle (`evals/skills-bundle/bundle.json`) is a manifest pointing
into this directory; the skill bodies live here as the single source of
truth.

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
