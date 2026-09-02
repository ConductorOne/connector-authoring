# Driver authoring contract

The eval runner consumes driver interfaces, not a hard-coded environment.
A driver supplies a `Provisioner` (tenant lifecycle), an `AgentDriver`
(agent + collector execution), and the run-channel prompt text. The public
repo ships one reference driver (`drivers/tier0/`); private drivers implement
the same contracts for credentialled tenants and real agent transports.

## Driver architecture

- **`Provisioner`** — `provision(ctx)` returns a `TenantHandle` (`baseUrl`,
  `credentials`, declared `toolSurface`); `checkReadiness(handle)` proves the
  tenant surface is reachable; `teardown(handle)` is best-effort and never
  throws. See `evals/runner/driver.ts` for the exact shapes.
- **`AgentDriver`** — `runAgent(req)` executes one agent (or collector) run
  against the tenant and returns an `AgentRunResult` carrying the parsed
  transcript, a timeout flag, and wall-clock time.
- **`RunChannel`** — the runner-owned local file contract: `runDir`,
  `handoffPath`, `scoreInputPath`, `transcriptPath`, plus the driver-supplied
  `handoffInstructions`/`completionInstructions` prompt text.

## Reserved control names

Every driver maps its control-plane calls to the reserved tool names:

- `driver.write_file` — the handoff write; `args.path` carries the target
  path (the S11 handoff-discipline gate matches
  `driver.write_file` whose `args.path === channel.handoffPath`).
- `driver.complete_run` — the terminal call that ends the run.

`stageForTool` returns `null` for any `driver.*` name — control-plane calls
are never funnel stages.

## Run-channel obligations

The driver must:

- write the agent's handoff to `channel.handoffPath`,
- write the collector's score-input to `channel.scoreInputPath`,
- persist the raw transcript to `channel.transcriptPath`,
- return the parsed transcript in `AgentRunResult.transcript` (the runner
  scores that stream; `transcriptPath` is the on-disk record).

How the agent's bytes reach `handoffPath` is the driver's transport concern —
private drivers map their remote file system onto the same logical contract.

## Readiness gate

The driver's `checkReadiness` performs only the concrete tenant-reachability
check. The runner then verifies the scenario's `readinessTools` are all
present in the driver's declared `toolSurface`; a missing tool is a
`ReadinessError` (exit 2, no record).

## Recovering the original implementation

The original implementation is recovered from git history at the merge of the
harness-shipping PR.

## Tier-0 reference driver

`drivers/tier0/driver.ts` is the reference implementation of the contract: its
provisioner spawns the local fixture (`evals/fixture/server.ts`) as a child
process on an ephemeral port and declares the full 16-tool surface; its agent
driver replays the committed canned artifacts (`transcript.json`,
`handoff.json`, `score-input.json`) into the run channel; its readiness check
is the authenticated `GET /v1/users?account_id=acct-1` probe. `driver.test.ts`
is the reference test shape for private drivers — provision/readiness against
the live tenant, a canned run that scores a schema-valid record, and an
end-to-end CLI registry-resolution check.
