# Eval harness — connector-authoring

A scenario-driven eval runner that scores the in-app authoring funnel
**deterministically** (no LLM judge for ~90% of stages), plus a deterministic
fixture provider for the agent to sync against. The runner consumes
`Provisioner`/`AgentDriver` interfaces; the public repo ships the Tier-0
local/static driver, which runs a scenario end-to-end against the local
fixture and produces a scored JSONL record with the full S0–S11 stage funnel.

## Layout

| Path | Purpose |
|---|---|
| `evals/fixture/` | Deterministic Directory API fixture (zero-dependency `node:http`) |
| `evals/runner/` | Runner + scorer (`run.ts` CLI, driver interfaces, stage gates) |
| `evals/runner/drivers/` | Driver implementations — Tier-0 local/static driver; authoring contract in `drivers/README.md` |
| `evals/scenarios/` | Scenario definitions (`tier1-directory.json`, `tier1-directory-guide-only.json`, `tier1-directory-full.json`, `pre1-directory-proceed.json`, `pre1-noiam-park.json`) |
| `evals/skills-bundle/` | Skill-bundle mount point (v0.3.0 manifest — seven skills in `skills/`) |
| `evals/results/` | JSONL run records (gitignored; `.gitkeep` committed) |

## How to run

```bash
# start the fixture locally (port 18080)
npm run eval:fixture

# verify the fixture (all 19 assertions, port 18081; requires curl + jq)
npm run eval:verify

# run the committed unit smokes (scorer/parser/stages/record/scenario/driver)
npm run eval:test

# run a scenario end-to-end with the Tier-0 driver (no credentials, no
# network beyond localhost — replays committed artifacts)
npm run eval:run -- --scenario evals/scenarios/tier1-directory.json --driver tier0
```

Runner CLI:

```
node evals/runner/run.ts --scenario <path> [--ref <git-ref>] [--driver <name>] [--out <dir>] [--max-agent-minutes <n>]
```

- `--scenario` required. `--ref` optional and driver-interpreted (Tier-0
  ignores it). `--driver` selects the driver (default `tier0`). `--out`
  overrides the results dir (default `evals/results`). `--max-agent-minutes`
  bounds the agent-run wait (default 60); on timeout the runner scores the
  PARTIAL stream and unreached stages as fail rows — a legitimate scored
  outcome, never a hung runner.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Record written — a scored outcome, even if the agent failed stages, timed out, or never wrote the handoff |
| 2 | Readiness failure (distinct `READINESS FAILURE:` message; NO record written) |
| 1 | Any other error (bad args, invalid scenario, collector failure) |

## Readiness gate

The driver's `checkReadiness` proves the tenant surface is reachable; the
runner then verifies the scenario's five readiness tools are present in the
driver's declared tool surface. Failure → teardown, abort, retry with a fresh
provision (max 2 retries); an unready run is NEVER scored. The run meta
records `funnel_tools_present`.

## Handoff contract

The agent must write `handoff.json` (all 10 fields: `catalog_id`, `draft_id`,
`upload_id`, `run_id`, `revision_id`, `app_id`, `connector_id`,
`test_run_id`, `deployment_instance_id`, `activation_url`) to the run
channel's `handoffPath` (`<out>/<run-id>/handoff.json` for Tier-0) via the
driver's transport, then STOP. It never redeems the approval token, never
polls `REVISION_STATUS_ACTIVE`, never calls `c1_connector_service_force_sync`
(activation is human-only; `REVISION_STATUS_ACTIVE` and `SYNC_STATUS_DONE`
are recorded as `skipped_human_boundary`).

## Record schema (JSONL)

`evals/results/<run-id>.jsonl` — 16 lines:

1. **Run meta:** `{run_id, scenario, skill_bundle_version, skill_bundle_mode, model_version, harness, reasoning_effort, started_at, wall_time_ms, funnel_tools_present}`
2–13. **Stage rows** S0–S11: `{stage, gate, pass, first_pass, attempts, evidence}` (`pass` boolean; `first_pass` boolean; `attempts` int; `evidence` string)
14–15. **Skipped rows:** `{stage: "S11b", gate: "REVISION_STATUS_ACTIVE", pass: "skipped_human_boundary"}` and `{stage: "S11c", gate: "SYNC_STATUS_DONE", pass: "skipped_human_boundary"}`
16. **Summary:** `{summary: true, funnel, first_pass_rate, recovery_cycles, parity_verdict, parity_evidence, parity_tenant, parity_tenant_evidence, hygiene_verdict, hygiene_evidence, handoff_discipline_verdict, tool_calls, turns, tokens_in, tokens_out}`

Example lines:

```json
{"run_id":"evals-tier1-directory-20260902-081500","scenario":"tier1-directory","skill_bundle_version":"0.0.0","skill_bundle_mode":"none","model_version":"together/deepseek-ai/DeepSeek-V4-Flash-0731","harness":"tier0","reasoning_effort":"high","started_at":"2026-09-02T08:15:00.000Z","wall_time_ms":123456,"funnel_tools_present":true}
{"stage":"S0","gate":"guide read","pass":true,"first_pass":true,"attempts":1,"evidence":"transcript has 1 successful get_authoring_guide call(s)"}
{"stage":"S11b","gate":"REVISION_STATUS_ACTIVE","pass":"skipped_human_boundary"}
{"summary":true,"funnel":["S0","S1","S2","S3","S4","S5","S6","S7","S8","S9","S10","S11"],"first_pass_rate":1.0,"recovery_cycles":0,"parity_verdict":"PASS","parity_evidence":"all 5 static source checks pass (account_id, user.title, totalPath, config literals, newUserResource + user.id)","parity_tenant":"not_applicable","parity_tenant_evidence":"draft test did not persist synced resources (tenant counts 0) — parity measured statically from source","hygiene_verdict":"PASS","hygiene_evidence":"all 4 files present; dual-schema parity; api-token secret in both; no plaintext fixture-token; bundle caps respected","handoff_discipline_verdict":true,"tool_calls":42,"turns":8,"tokens_in":null,"tokens_out":null}
```

`tokens_in`/`tokens_out` are `null` when the stream carries no usage events —
never invented.

## Stage table (S0–S11)

| Stage | Gate | Evidence |
|---|---|---|
| S0 | guide read | ≥1 successful `get_authoring_guide` call in the transcript |
| S1 | `catalog_id` + `draft_id` | both non-empty in handoff; ≥1 successful `create_draft` call in the transcript |
| S2 | `upload_id` + PUTs 200 | handoff `upload_id`; ≥1 successful `create_draft_source_upload`; no `-X PUT` bash call whose result lacks `200` |
| S3 | required source files | all 4 `required_source_files` true in score-input |
| S4 | build `run_id` | handoff `run_id` non-empty; ≥1 successful `build_bundle` call in the transcript |
| S5 | `RUN_STATE_SUCCEEDED` + `revision_id` | score-input `build_run.state`; handoff `revision_id` |
| S6 | `app_id` | handoff non-empty; ≥1 successful `apps_create` call in the transcript |
| S7 | `connector_id` | handoff non-empty; ≥1 successful `provision_connector` call in the transcript |
| S8 | credentials configured | score-input `connector_config` base-url/account-email/api-token all non-empty |
| S9 | `test_run_id` | handoff non-empty; ≥1 successful `run_draft_test_sync` call in the transcript |
| S10 | durable PASS evidence | score-input `evidence.result == "PASS"` |
| S11 | handoff discipline | deploy + mint succeeded; all 10 handoff fields; zero tool calls after the mint except the handoff write; no token redemption |

## Pre-1 kind (P0–P4)

A `kind: "pre1"` scenario runs the pre-1 judgment phase instead of the funnel:
the agent sources the provider's OpenAPI spec and designs the access model,
then writes a `pre1.json` artifact to the run channel's `pre1Path` and stops.
Pre-1 scenarios carry `providerBrief`, `expectedDecision` (`"proceed"` or
`"park"`), and exactly one of `expectedAccessModel` (proceed) or
`expectedParkEvidence` (park); the funnel-only fields (`seed`, `expected`,
`requiredSourceFiles`) must be absent. The Tier-0 driver replays canned
artifacts from `drivers/tier0/canned-<scenario.id>/`.

Pre-1 records are scored against the P0–P4 gate set:

| Stage | Gate | Evidence |
|---|---|---|
| P0 | artifact written | `pre1.json` present with a `decision` of `"proceed"` or `"park"` |
| P1 | decision correctness | `decision === expectedDecision` — the separately-measured park-vs-proceed metric |
| P2 | access-model match (proceed) | resource-type `{id, traits}` pairs, entitlement slugs, and grant edges set-equal to the expected sets; `id_compatibility` non-empty; every `provisioning` entry justified with a boolean `provisionable` |
| P3 | sourcing provenance (proceed) | `spec_url`/`fetched_at`/`authority_rung` non-empty; `spec_bytes` a positive integer < 1048576 |
| P4 | park evidence (park) | all four `park_evidence` fields non-empty with `missing_paths` a non-empty array |

The record's summary carries `decision_verdict` (`"proceed"`/`"park"` when P1
passes, `"incorrect"` otherwise) and `decision_evidence` (the P1 row's
evidence) — the park-vs-proceed metric is measured from these fields.
`parity_verdict`/`hygiene_verdict` are `"PASS"` with evidence
`"not applicable (pre1 run)"`; `parity_tenant` is `"not_applicable"`;
`handoff_discipline_verdict` is `true`; `recovery_cycles` is 0. Pre-1 records
write no skipped rows (`skippedRows = []`).

Pre-1 `first_pass_rate` is passes over the gate count for the expected
decision — 4 for proceed runs (P0–P3), 3 for park runs (P0/P1/P4) — so it is
comparable only between runs of the same expected decision, not across the
two pre1 scenarios. `first_pass`/`attempts` on pre-1 stage rows mirror `pass`
(1/0) rather than transcript-derived attempts, unlike the funnel path.

## Fixture traps

The fixture (`evals/fixture/`) mirrors the documented failure modes:

1. **Under-sync trap (a):** `GET /v1/users` without the required `account_id`
   scoping param returns only the 3-row unscoped subset, not the full 23.
2. **Nullable title (b):** `user.title` is `null` for 3 users — a projection
   that assumes non-null drops those profiles.
3. **Idempotency replay (c):** a replayed grant POST returns `200` with
   `X-Idempotency-Replay: true` (first time is `201`).

## Parity + hygiene verdicts

- **`parity_verdict`** is computed STATICALLY from the uploaded `connector.ts`
  source (five literal-substring checks: `account_id`, `user.title`,
  `totalPath`, the three `config("...")` literals, `newUserResource` +
  `user.id`). **Bundle-arm comparability caveat:** the full skill bundle
  teaches the scored literals (`totalPath`, `newUserResource` + `user.id`)
  directly, while the `none`/`guide-only` arms must discover them from the
  SDK declarations and examples every checkout exposes, so parity-stage
  results are not comparable across bundle arms — a full-mode pass reflects
  the skill's teaching, not a capability the other arms lack. **Measurement
  boundary:** the draft test sync runs Validate +
  GetMetadata only and PASS requires "no write attempt" — synced resources
  appear in the tenant only after force sync, which the eval forbids
  (activation is human-only). Post-draft-test tenant counts are therefore
  ZERO BY CONSTRUCTION, so a tenant-count parity verdict would be structurally
  always-FAIL. `parity_tenant` (the post-draft-test tenant counts + resource
  ids the collector records) is an OBSERVATION, not the verdict: when zero it
  is recorded as `not_applicable` with the explanation carried in
  `parity_tenant_evidence` ("draft test did not persist synced resources
  (tenant counts 0) — parity measured statically from source");
  `parity_evidence` always carries the static source-check evidence, so a
  `parity_verdict: "FAIL"` is diagnosable from the record alone. Full-sync
  parity after activation is out of scope for the public repo.
- **`hygiene_verdict`** PASS iff: all 4 required source files present;
  `config-schema.json` and `runtime-schema.json` declare the same field names
  (dual-schema parity); `api-token` is `is_secret`/`isSecret` in both
  schemas; the literal `fixture-token` appears in NO uploaded source file (no
  plaintext secrets); bundle caps respected (each file ≤ 12 MiB, total ≤
  16 MiB, ≤ 256 files). **Bundle-arm comparability caveat:** the full skill
  bundle teaches dual-schema parity directly, while the `none`/`guide-only`
  arms must infer it from the paired example schemas every checkout exposes;
  the no-fixture-credentials hygiene rule is genuinely bundle-only (`is_secret`
  and the bundle caps come from the served guide every arm reads at step 0),
  so hygiene-stage results are likewise not comparable across bundle arms.

## Baseline + regression gate

The control-group baseline (CXF-217) is six scored Tier-1 runs — scenario
`tier1-directory` × skill-bundle modes {`none`, `guide-only`} × 3 runs each —
with the model pinned to `together/deepseek-ai/DeepSeek-V4-Flash-0731` and
`reasoningEffort: "high"` in both scenario files. Each run writes a JSONL
record to `evals/results/<run-id>.jsonl` (gitignored).

Regenerate the committed reference with:

```bash
npm run eval:baseline
```

`evals/runner/baseline.ts` reads every `*.jsonl` record in `evals/results/`
(or `--out <dir>`), validates each record (meta fields, the 12 canonical stage
rows S0–S11, skipped rows, summary), enforces cross-record model/effort
consistency, and writes `evals/results/baseline.json` — the locked v1 schema:
`{schema_version, generated_at, model, reasoning_effort, scenarios, modes,
pareto}`. A run is a pass iff every stage row S0–S11 has `pass === true`
(S11b/S11c `skipped_human_boundary` rows excluded). `modes.<mode>` carries
`run_ids`, `runs`, `passes`, `pass_rate`, `pass_at_3`, `first_pass_rate_mean`,
and `per_stage` failures; `pareto` ranks stages by failure count.
`pass_at_3` is `number | null`: 1 when any of the first three runs (by `run_id`
ascending) passes, 0 when none do, and `null` when the mode has fewer than 3
runs. Records whose `skill_bundle_mode` is outside the {`none`, `guide-only`}
matrix (e.g. a `full`-mode run) are skipped with a one-line stderr warning,
never validated or fatal; the generator exits 1 only when no matrix records
remain. `generated_at` is the newest record's `started_at` (not the wall-clock
generation time) so identical inputs produce an identical file. Each mode
group must contain exactly one distinct scenario id — a mixed-scenario mode
is an error naming the conflicting files.

**Regression-gate contract.** The CI regression gate (a later PR) reruns the
pinned scenarios on a skill PR and fails if the measured pass rate drops below
`modes.<mode>.pass_rate` in the committed `evals/results/baseline.json`. The
gate workflow itself is not built in this batch; the committed file plus this
consumption rule is the reference.

**Halt-path status.** The E2E runs that would produce the six records are
blocked (see E2E status below), so no scored runs exist and no
`baseline.json` is committed. The generator is covered by unit smokes
(`evals/runner/baseline.test.ts`); the reference will be published once a
real-tenant driver and the tool surface are available.

## Non-goals

- The remaining three skills (verify-connector-output, update-and-rollback, diagnose-authoring-failure) — later PRs.
- Tier-2 real sandbox providers and the qualitative LLM-judge tier.
- Operator-side activation E2E leg (redeeming the approval token) — those two
  fields are `skipped_human_boundary`.
- Baseline matrix runs and CI regression gating — the runs are blocked on the
  E2E tool surface (halt path); no `baseline.json` is committed in this PR.
- The `/v2` fixture surface (bearer + link pagination) is fixture capability
  asserted by `verify.sh` only; the Tier-1 agent uses `/v1` (basic + offset).
- Tier-1+ end-to-end runs require a private driver (credentials + a real
  agent transport); that driver is out of scope for the public repo.

## Implementation notes

- **Evals-scoped tsconfig.** `evals/tsconfig.json` extends the root
  `tsconfig.json` and adds the evals-only compiler options (`lib: ES2024` for
  `Promise.withResolvers`, `allowImportingTsExtensions` for the `.ts`-extension
  imports). The root tsconfig is unchanged for the pre-existing
  `examples/**/*.ts` and `baton/**/*.d.ts` surface — the evals options do not
  leak into the repo-wide type environment. `npm run typecheck` runs both
  configs; the CI workflow is unmodified.
- **E2E status.** The Tier-1 end-to-end run (done-definition 4) is BLOCKED.
  The public repo ships only the Tier-0 local driver (canned transcript); a
  Tier-1+ run needs a private driver with real tenant credentials and an
  agent transport, which is out of scope for the public repo. The CXF-217
  preflight (on the Squire-based harness) also established a structural
  blocker on the c1 side: fresh c1-image eval envs expose no
  `c1_connector_authoring_*` tools even with `CONNECTOR_AUTHORING` effective
  (the `c1.api.*` MCP surface is not mounted in this region's envs) —
  evidence at `/current-tasks/src-tu2rs/results/BLOCKER.md`. The batch halted
  per done-definition 7; the runner, scorer, and stage gates are covered by
  the committed unit smokes (`npm run eval:test`), and the E2E must run once
  a real-tenant driver and the tool surface are available.
- **Score-input boundary.** `score-input.json` is written by a collector
  agent that transcribes tenant tool responses; the scorer type-validates but
  cannot verify truthfulness. The collector reads the agent-written handoff
  from the run channel itself (values are never interpolated into its prompt),
  so an untrusted handoff cannot inject instructions into the collector.
