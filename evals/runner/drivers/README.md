# Driver authoring contract

The eval runner consumes driver interfaces, not a specific runtime. A driver
implements the `Provisioner`, `AgentDriver`, and `RunChannel` contracts
defined in `evals/runner/driver.ts`; the runner resolves drivers by name
through its registry (`--driver <name>`, default `tier0`).

## Driver architecture

- **Provisioner** — `provision(ctx)` returns a `TenantHandle` (base URL,
  credentials, declared tool surface) for a fresh tenant; `checkReadiness(handle)`
  proves the tenant surface is reachable; `teardown(handle)` releases it
  best-effort (never throws). `ctx.ref` is the git ref under test
  (`--ref`), driver-interpreted.
- **AgentDriver** — `runAgent(req)` runs one agent (or collector) turn against
  the tenant and returns an `AgentRunResult` carrying the parsed transcript,
  the timeout flag, wall time, and — when the driver knows the stream
  collection failed — `collectionFailed: true` (the runner then refuses to
  score an empty transcript as an all-fail outcome). `req.ref` is the git ref
  under test, driver-interpreted.
- **RunChannel** — the runner-owned local file contract: `runDir`,
  `handoffPath`, `scoreInputPath`, `transcriptPath`, plus the driver-supplied
  `handoffInstructions`/`completionInstructions` prompt text.

## Reserved control names

Every driver maps its control-plane calls to the reserved tool names:

- `driver.write_file` — the handoff write; `args.path` carries the target
  path (the S11 handoff-discipline gate matches
  `driver.write_file` whose `args.path === channel.handoffPath`).
- `driver.complete_run` — the terminal call; the S11 gate treats it as the
  end of the run.

`stageForTool` returns `null` for any `driver.*` name — control-plane calls
are never funnel stages.

## Run-channel obligations

The driver must:

1. Write the agent's handoff to `channel.handoffPath`.
2. Write the collector's score-input to `channel.scoreInputPath`.
3. Persist the raw transcript to `channel.transcriptPath` for the record.
4. Return the parsed transcript in `AgentRunResult.transcript` (the runner
   scores that stream; it never re-reads the raw transcript).

## Readiness gate

The driver's `checkReadiness` performs ONLY the concrete tenant-reachability
check. The runner then verifies the scenario's `readinessTools` are all
present in the handle's declared `toolSurface`; a missing tool is a
`ReadinessError` (exit 2, no record). The record's `funnel_tools_present` is
derived by the runner from the declared surface against the full funnel list
(`FUNNEL_TOOLS` in `driver.ts`) — never from a driver assertion, so a driver
that declares a partial surface is recorded honestly.

## Recovering the original implementation

The original implementation is recoverable from git history at the merge of
the harness-shipping PR.

## Tier-0 reference driver

`drivers/tier0/driver.ts` is the reference implementation of the contract: it
spawns the local fixture (`evals/fixture/server.ts`) on an ephemeral port,
replays the committed canned artifacts (`transcript.json`, `handoff.json`,
`score-input.json`) into the run channel, and declares the full tool surface.
`drivers/tier0/driver.test.ts` is the reference test shape for private
drivers — provisioner readiness against the live fixture, canned-run replay,
and an end-to-end CLI resolution test.
