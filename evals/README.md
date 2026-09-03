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
| `evals/scenarios/` | Scenario definitions (`tier1-directory.json`) |
| `evals/skills-bundle/` | Skill-bundle mount point (plumbing only — no skills yet) |
| `evals/results/` | JSONL run records (gitignored; `.gitkeep` committed) |

## How to run

```bash
# start the fixture locally (port 18080)
npm run eval:fixture

# verify the fixture (all 16 assertions, port 18081; requires curl + jq)
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
{"run_id":"evals-tier1-directory-20260902-081500","scenario":"tier1-directory","skill_bundle_version":"0.0.0","skill_bundle_mode":"none","model_version":"together/deepseek-ai/DeepSeek-V4-Flash-0731","harness":"tier0","reasoning_effort":"n/a","started_at":"2026-09-02T08:15:00.000Z","wall_time_ms":123456,"funnel_tools_present":true}
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
  `user.id`). **Measurement boundary:** the draft test sync runs Validate +
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
  16 MiB, ≤ 256 files).

## Non-goals

- The skills themselves (orchestrator/stage/diagnose) — later PRs.
- Tier-2 real sandbox providers and the qualitative LLM-judge tier.
- Operator-side activation E2E leg (redeeming the approval token) — those two
  fields are `skipped_human_boundary`.
- Baseline matrix runs and CI regression gating.
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
- **Score-input boundary.** `score-input.json` is written by a collector
  agent that transcribes tenant tool responses; the scorer type-validates but
  cannot verify truthfulness. The collector reads the agent-written handoff
  from the run channel itself (values are never interpolated into its prompt),
  so an untrusted handoff cannot inject instructions into the collector.
