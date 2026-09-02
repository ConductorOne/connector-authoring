# Connector-authoring eval harness

The measurement loop for measurable agent skills (CXF-70). A scenario-driven
runner provisions a fresh c1-image Squire environment per run, drives an agent
under test through the in-app connector-authoring lifecycle against a
deterministic fixture provider, and scores the run **deterministically** — no
LLM judge for the funnel. Every run appends one JSONL record to the results
store so skill changes can be measured against a recorded baseline.

"Measurable" is the point: the in-app authoring lifecycle's stop-if gates are
already machine-checkable, so the harness exists before the skills it
measures.

## Layout

```
evals/
  src/                 the harness (runner, readiness gate, scorer, records)
  src/scorer/          deterministic scoring: stages, recovery, synced data,
                       source hygiene, handoff discipline
  scenarios/           scenario definitions (provider brief + expectations)
  skill-bundles/       skill conditions: none / guide-only / full@<version>
  fixture/directory-api/  the Tier-1 fixture provider (container)
  test/                unit + live-fixture tests (node --test)
  results/             JSONL run records (gitignored)
```

## Prerequisites

- Node >= 22.18 (the harness and fixture run TypeScript directly via type
  stripping; `tsc` only typechecks).
- `squire-tool` on PATH, authenticated to a Squire gateway (the harness runs
  inside a Squire env or on an enrolled operator workstation). Override the
  binary with `SQUIRE_TOOL`.
- The fixture provider reachable from the eval tenant (see "Fixture
  placement" below).

## Running

Serve the fixture (external mode):

```sh
node evals/src/cli.ts fixture --port 8080
# or: docker build -t c1-eval-directory-api evals/fixture/directory-api
#     docker run --rm -p 8080:8080 c1-eval-directory-api
```

Run a scenario:

```sh
node evals/src/cli.ts run \
  --scenario tier1-directory \
  --fixture-url http://host-reachable-from-eval-tenant:8080 \
  --bundle guide-only \
  --model together/deepseek-ai/DeepSeek-V4-Flash-0731 \
  --runs 3
```

One run:

1. **Provisions** a fresh c1-image Squire env (`--image c1`). The env's
   primary task is a readiness probe; the agent under test runs as a sibling
   task afterwards.
2. **Readiness gate.** Layer 1: the probe waits for every service to be
   healthy and HTTP-probes the local product surface, then publishes
   `readiness.json`; the runner starts the agent only after that. Layer 2:
   the agent's first action must be a `c1_connector_authoring_*` tool call —
   if the `mcp__c1dev__*` tools are absent it stops with `READINESS_FAILED`.
   A run that cannot reach full readiness is **aborted and retried** with a
   fresh env (`--max-env-attempts`, default 2) and is never scored.
3. **Runs the agent** with the scenario's provider brief, the fixture
   credentials, and the selected skill bundle. The agent must maintain a
   handoff table (`handoff.json`) after every lifecycle step.
4. **Collects** post-run tenant state via a deterministic collector task in
   the eval env (counts, grant wiring, revision status, ID stability across
   two syncs) plus an archive of the agent's uploaded source set.
5. **Scores** the run and appends one JSONL record (see schema below).

Other commands:

```sh
node evals/src/cli.ts score --scenario tier1-directory --transcript t.json \
  [--collection c.json] [--source-dir dir] [--handoff h.json] \
  [--fixture-url http://localhost:8080]   # re-score a recorded run;
                                          # --fixture-url refreshes expectations live
node evals/src/cli.ts expectations [--fixture-url ...]          # live fixture counts
node evals/src/cli.ts bundles                                   # available skill bundles
node evals/src/cli.ts summarize [--results ...] [--scenario ...] # pass@1, first-pass rate, cost
```

## Scenarios

A scenario is a versioned JSON file: provider brief (name, docs URL, auth
scheme + eval-only credentials), credential-field names, the terminal stage
the scenario expects, and fixture expectations. The runner **refreshes
expectations from the fixture's live `/_fixture/expectations` endpoint** at
run time — count parity against the live API, never hardcoded seed lists.

- `tier0-static` — smoke tier. File contract + build path, no credentials;
  expects the agent to reach a built revision (S5). Mirrors `examples/static`.
- `tier1-directory` — the workhorse. Full lifecycle against the Directory API
  fixture through PASS evidence and the activation handoff (S11b +
  human boundary).
- Tier 2 (real sandbox provider) is future work; the scenario mechanism is
  tier-agnostic.

## Skill bundles

The skill condition is part of every run record (`skill_bundle_version`):

- `none` — bare prompt (control).
- `guide-only` — the agent reads the tenant-served authoring guide and
  follows it (control).
- `full@<version>` — the full skill set at a pinned version, inlined into the
  prompt from `skill-bundles/full/<version>/`. Shipped by the skills PRs;
  `cli.ts bundles` lists what is available.

Baseline delta = a bundle's pass rate minus the `none` pass rate — the causal
value of the skills.

## What the scorer measures

All deterministic, from the normalized tool-call transcript, the collector's
tenant snapshot, and the agent's source set. Re-scoring a recorded run
(`cli.ts score`) always reproduces the same result.

| Score | Source of truth |
|---|---|
| Stage funnel S0–S11d pass/fail | each step's stop-if gate: IDs non-empty, `RUN_STATE_SUCCEEDED`, PASS evidence row, `REVISION_STATUS_ACTIVE`, `SYNC_STATUS_DONE` |
| First-pass rate per stage | gate passed with no prior failing attempt (read-only polling is not a retry) |
| Recovery quality | fix→re-run cycles; correct-step re-runs (source update before rebuild; fresh `test_run_id` after FAIL; no token re-mint on a failed run) |
| Synced-data correctness | fixture parity counts, grant wiring (principal + entitlement resolve), ID stability across two syncs, plaintext-secret scan |
| Source hygiene | 4 required files, dual-schema field parity, `is_secret` on credential-class fields, `type` on every runtime field, no `fetch(`/hand pagination/secret literals, bundle caps (256 KiB / 1 MiB) |
| Handoff discipline | handoff table fully populated; agent stopped at the human activation boundary (no token redemption, no force sync before ACTIVE) |

**Funnel outcomes.** `agentComplete` = S0–S11b pass with a clean human
handoff — the gating metric, since activation is human-only by design.
`fullPass` additionally requires `REVISION_STATUS_ACTIVE` and
`SYNC_STATUS_DONE` (only reachable when a human OWNER activates during the
run window). Stages past a scenario's terminal stage are `not_applicable`;
stages after a failure are `blocked`, not `not_reached`.

## Run record schema (JSONL, `schema_version: 1`)

One line per run in `evals/results/runs.jsonl`:

```json
{
  "schema_version": 1,
  "run_id": "2026-09-02_05-00-00Z_tier1-directory_deepseek-v4-flash-0731_guide-only_ab12cd",
  "scenario": "tier1-directory",
  "skill_bundle": { "name": "guide-only", "version": "0" },
  "model": { "id": "together/deepseek-ai/DeepSeek-V4-Flash-0731", "reasoning_effort": null },
  "started_at": "...", "ended_at": "...", "wall_time_s": 1234,
  "env": { "env_id": "...", "image": "c1", "attempt": 1 },
  "readiness": { "ok": true, "attempts": 1, "services_healthy_at": "...",
                 "tools_present": true, "aborted": false, "abort_reason": null },
  "agent": { "task_id": "...", "status": "completed", "turns": 42,
             "tokens_in": 1000, "tokens_out": 2000, "tool_calls": 87, "tool_errors": 3 },
  "score": { "stages": { "S0": { "status": "pass", "firstPass": true, ... }, ... },
             "funnel": { "reached": "S11c", "agentComplete": true, "fullPass": false },
             "metrics": { "firstPassRate": 1.0, ... },
             "recovery": { "cycles": 0, "events": [] },
             "syncedData": { "parity": { "users": { "expected": 230, "actual": 230, "ok": true } },
                             "traps": { "domainScoping": "avoided", ... }, ... },
             "sourceHygiene": { "violations": [], ... },
             "handoff": { "tableComplete": true, "stoppedAtHumanBoundary": true, ... } },
  "error": null
}
```

Aborted runs (readiness never reached) carry `readiness.aborted: true`, an
`abort_reason`, and `score: null` — they are recorded for operations
visibility but excluded from pass-rate aggregation (`cli.ts summarize`).

## Fixture placement

The connector's `base-url` must be reachable from the eval tenant's managed
connector runtime. Two modes:

- **External** (`--fixture-url`): run the fixture anywhere the eval tenant
  can reach (operator host with a routable address, a small long-lived
  deployment). The runner health-checks it and queries it for expectations.
  This is the recommended mode.
- **In-env** (`--fixture-in-env`): the runner ships the fixture source into
  the eval env and the readiness probe starts it on `localhost:8080`.
  Reachability from the managed runtime depends on the c1dev network
  topology; the draft test's ConnectionOK gate proves it honestly. Use
  external mode unless you have verified your topology.

## The fixture provider (Tier 1)

See [`fixture/directory-api/README.md`](./fixture/directory-api/README.md).
A deterministic Directory API extending `examples/http`: published
`openapi.json`, seeded data, offset + link pagination variants, bearer +
basic auth variants, and deliberate traps (silent under-sync without a
scoping param, nullable fields, pending memberships that must not become
grants, grant/revoke idempotency signals). Each trap maps to a scorer check.

## Design decisions and limitations

- **Activation is human-only.** The agent is scored at PASS evidence +
  handoff discipline (`agentComplete`); `fullPass` requires a human OWNER to
  activate during the run window. The scorer flags any token-redemption
  attempt as a handoff violation.
- **The collector is a task, not direct REST.** Post-run tenant state is
  gathered by a pinned-script sibling task inside the eval env so the env's
  self-auth credentials never leave it. The runner validates the collection's
  shape; a malformed collection makes the run collection-failed, never
  silently scored.
- **Transcript normalization is alias-tolerant.** Harnesses emit differently
  shaped firehose events; the normalizer extracts tool calls/results/usage
  across the known shapes and treats anything unrecognized as opaque. Token
  and turn counts are recorded as null when the harness does not emit usage —
  never fabricated.
- **Bundle caps are scored on source sizes** (the pre-embed inputs to the two
  build caps), a documented approximation of the build's post-bundle
  measurement.
- **Tier 2** (real sandbox provider, e.g. an Okta dev tenant) and the
  optional LLM-judged qualitative tier are deliberately out of scope; the
  scenario and scorer seams for both exist.

## Development

```sh
npm run evals:typecheck   # strict tsc over evals/
npm run evals:test        # unit + live-fixture tests (boots the fixture in-process)
```
