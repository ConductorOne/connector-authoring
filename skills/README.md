# Agent skills

The ten skills shipped in this batch: the five funnel skills and two
pre-1 skills authored against the v0.0.26 DSL contract and the 23-tool tenant MCP surface; validated by the eval suite, plus three post-funnel and cross-cutting skills
(`verify-connector-output`, `update-and-rollback`,
`diagnose-authoring-failure`) over the tenant connector and authoring
tool surface. Each skill's `SOURCES.md` names the pinned sources with
their SHAs.

| Skill | Stage coverage | Source basis |
|---|---|---|
| `author-in-app-connector` | Orchestrator — the full S0–S11 funnel | MCP-served guide, `authoring.proto`, lifecycle doc |
| `read-authoring-contract` | Stage 0 — guide + SDK contract read | MCP-served guide, `authoring.proto` |
| `write-connector-source` | Source authoring before S2 — the four-file source contract | MCP-served guide, `authoring.proto`, lifecycle doc, `runtime-gotchas.md`, shopify Makefile |
| `build-and-test` | Stages 2–5, 9–10 — upload, build, draft test | MCP-served guide, `authoring.proto`, lifecycle doc |
| `deploy-and-activate` | Stages 6–8, 11 — app, provision, configure, deploy, mint, handoff | MCP-served guide, `authoring.proto`, lifecycle doc |
| `design-access-model` | Pre-1 — access-model design for net-new providers | baton-admin `design-baton-access-model` @ `6fe6886f…` |
| `source-openapi-spec` | Pre-1 — OpenAPI spec sourcing + IAM go/no-go | claude-marketplace `source-openapi-spec` @ `0cc5ac2a…` |
| `verify-connector-output` | Post-11 - post-sync verification (counts, grant wiring, ID stability, UI spot-check) | MCP-served guide, lifecycle doc, `probe-contracts.md` @ `0cc5ac2a…` |
| `update-and-rollback` | Post-activation - same-catalog update + REST rollback | MCP-served guide, `authoring.proto`, lifecycle doc |
| `diagnose-authoring-failure` | Cross-cutting - symptom -> cause -> fix router | lifecycle doc, baton-admin `diagnose-connector-failure` @ `6fe6886f…` |

The eval bundle (`evals/skills-bundle/bundle.json`) is a manifest pointing
into this directory; the skill bodies live here as the single source of
truth.

## Eval evidence

The measurable evidence for these skills is the deterministic, committed,
executable eval harness in `evals/`:

- **Tier-0 scored replay** — `npm run eval:run -- --scenario evals/scenarios/tier1-directory.json --driver tier0` replays a committed scenario end-to-end against the local fixture and produces a scored JSONL record of the full S0–S11 funnel (no credentials, no network beyond localhost).
- **Unit smokes** — `npm run eval:test` runs the committed scorer/parser/stages/record/scenario/driver tests.
- **Scorer + fixture harness** — `evals/runner/score.ts` and `evals/fixture/` are the deterministic scoring and fixture layers the replay exercises.

The Tier-1 baseline E2E (baseline vs with-skills pass rates on a real tenant)
is structurally blocked: the public repo ships only the Tier-0 canned driver
(no real-tenant driver), and the c1-side MCP surface on eval environments
exposes no `c1_connector_authoring_*` tools. Per the carry-forward rule
established in the merged PRs #10/#11, the baseline blocker is carried
forward; no pass-rate numbers are reported because none exist.
