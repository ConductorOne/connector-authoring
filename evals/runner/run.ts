// run.ts — eval runner CLI (CXF-216 PR 1, L18).
// Usage: node evals/runner/run.ts --scenario <path> --ref <git-ref>
//   [--task-id <id>] [--env <env-id>] [--keep-env] [--out <dir>] [--max-agent-minutes <n>]
// Exit codes: 0 = record written (a scored outcome, even if the agent failed
// stages, timed out, or never wrote the handoff); 2 = readiness failure
// (distinct; NO record written); 1 = any other error.
import {argv, exit, stderr, stdout} from "node:process"
import {call, fsRead, resolveTaskId, taskStream, type CallOpts} from "./squire.ts"
import {loadScenario, type Scenario} from "./scenario.ts"
import {provisionEnv, retryProvision, teardownEnv} from "./provision.ts"
import {ReadinessError, waitForReady} from "./readiness.ts"
import {installFixture} from "./fixture-install.ts"
import {buildPrompt, createAgentTask, waitForAgentTask} from "./agent.ts"
import {parseStream, pollStreamIncrementally} from "./stream.ts"
import {collect} from "./collect.ts"
import {SKIPPED_STAGES, STAGES, type Handoff, type ScoreInput, type StageCtx} from "./stages.ts"
import {scoreRun, type StageRow} from "./score.ts"
import {writeRecord, type RunMeta, type SummaryLine} from "./record.ts"

const HANDOFF_FIELDS: (keyof Handoff)[] = [
  "catalog_id",
  "draft_id",
  "upload_id",
  "run_id",
  "revision_id",
  "app_id",
  "connector_id",
  "test_run_id",
  "deployment_instance_id",
  "activation_url",
]

function usage(): void {
  stderr.write(
    "usage: node evals/runner/run.ts --scenario <path> --ref <git-ref> [--task-id <id>] [--env <env-id>] [--keep-env] [--out <dir>] [--max-agent-minutes <n>]\n",
  )
}

interface CliArgs {
  scenario: string
  ref: string
  taskId?: string
  env?: string
  keepEnv: boolean
  out: string
  maxAgentMinutes: number
}

function parseArgs(args: string[]): CliArgs {
  const out: CliArgs = {scenario: "", ref: "", keepEnv: false, out: "evals/results", maxAgentMinutes: 60}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    switch (a) {
      case "--scenario":
        out.scenario = args[++i] ?? ""
        break
      case "--ref":
        out.ref = args[++i] ?? ""
        break
      case "--task-id":
        out.taskId = args[++i] ?? ""
        break
      case "--env":
        out.env = args[++i] ?? ""
        break
      case "--keep-env":
        out.keepEnv = true
        break
      case "--out":
        out.out = args[++i] ?? ""
        break
      case "--max-agent-minutes": {
        const n = Number(args[++i])
        out.maxAgentMinutes = Number.isFinite(n) && n > 0 ? n : 60
        break
      }
      case "--help":
      case "-h":
        usage()
        exit(1)
      default:
        stderr.write(`unknown argument: ${a}\n`)
        usage()
        exit(1)
    }
  }
  if (!out.scenario || !out.ref) {
    usage()
    exit(1)
  }
  return out
}

function runIdFor(scenario: Scenario, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  return `evals-${scenario.id}-${stamp}`
}

function handoffComplete(h: Handoff): boolean {
  return HANDOFF_FIELDS.every((f) => typeof h[f] === "string" && (h[f] as string).length > 0)
}

async function readHandoff(handoffPath: string, opts: CallOpts): Promise<Handoff | null> {
  try {
    const res = (await fsRead(handoffPath, opts)) as Record<string, unknown>
    const content = res.content as string | undefined
    if (typeof content !== "string" || content.length === 0) return null
    const parsed = JSON.parse(content) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
    return parsed as Handoff
  } catch {
    return null
  }
}

// L18 stalled-agent path: S1..S10 fail with the locked evidence; S0 and S11
// are scored from the transcript/handoff as available.
function applyStalledAgentEvidence(rows: StageRow[]): StageRow[] {
  return rows.map((r) => {
    if (r.stage === "S0" || r.stage === "S11") return r
    return {...r, pass: false, first_pass: false, evidence: "handoff incomplete - agent stalled"}
  })
}

async function main(): Promise<number> {
  const cli = parseArgs(argv.slice(2))
  const scenario = loadScenario(cli.scenario)
  const taskId = resolveTaskId(cli.taskId)
  const opts: CallOpts = {taskId}
  const runId = runIdFor(scenario, new Date())
  const startedAt = new Date().toISOString()
  const handoffPath = scenario.handoffPath.replace("<run-id>", runId)
  const provisioned = !cli.env

  let envId: string
  let funnelToolsPresent = false
  if (provisioned) {
    const {envId: e} = await retryProvision(
      scenario,
      runId,
      async (eid) => {
        const r = await waitForReady(eid, scenario, runId, opts)
        funnelToolsPresent = r.funnelToolsPresent
      },
      3,
      opts,
    )
    envId = e
  } else {
    envId = cli.env
    // --env mode: single readiness attempt, no retries, no teardown.
    const r = await waitForReady(envId, scenario, runId, opts)
    funnelToolsPresent = r.funnelToolsPresent
  }

  const {baseUrl} = await installFixture(envId, scenario, runId, cli.ref, opts)

  const prompt = buildPrompt(scenario, runId, baseUrl, cli.ref)
  const {taskId: agentTaskId} = await createAgentTask(envId, scenario, runId, prompt, opts)

  // Wait with the --max-agent-minutes bound while the firehose accumulates.
  let stopPolling = false
  const streamEvents: unknown[] = []
  const poller = pollStreamIncrementally(
    envId,
    agentTaskId,
    (ev) => streamEvents.push(...ev),
    30_000,
    () => stopPolling,
    opts,
  )
  const {terminal, wallTimeMs, timedOut} = await waitForAgentTask(
    envId,
    agentTaskId,
    cli.maxAgentMinutes * 60 * 1000,
    opts,
  )
  stopPolling = true
  const {lastSeq} = await poller
  // final drain: catch anything appended after the last cursor
  const tail = (await taskStream(envId, agentTaskId, {sinceSeq: lastSeq, limit: 500}, opts)) as Record<string, unknown>
  const tailEvents = (tail.events ?? []) as unknown[]
  if (tailEvents.length > 0) streamEvents.push(...tailEvents)
  if (timedOut) {
    stderr.write(`WARNING: agent task ${agentTaskId} did not reach terminal within ${cli.maxAgentMinutes} min — scoring the partial stream\n`)
  }

  const transcript = parseStream(streamEvents)

  // Handoff: missing/incomplete -> L18 stalled-agent path.
  const handoff = (await readHandoff(handoffPath, opts)) ?? {}
  const handoffOk = handoffComplete(handoff)
  if (!handoffOk) {
    stderr.write(`WARNING: handoff.json missing or incomplete at ${handoffPath} — stalled-agent path\n`)
  }

  // Collect (runs even on the stalled-agent path, with nulls substituted).
  const {scoreInput, notes} = await collect(envId, scenario, runId, handoff, opts)

  const ctx: StageCtx = {transcript, handoff, scoreInput, handoffPath}
  const scored = scoreRun(ctx)
  const stageRows = handoffOk ? scored.stageRows : applyStalledAgentEvidence(scored.stageRows)

  // Run meta: harness/reasoning_effort are inherited (no override).
  let harness = "inherit"
  try {
    const identity = (await call("squire.identity", {}, opts)) as Record<string, unknown>
    if (typeof identity.harness === "string" && identity.harness.length > 0) harness = identity.harness
  } catch {
    // non-fatal: keep "inherit"
  }
  const meta: RunMeta = {
    run_id: runId,
    scenario: scenario.id,
    skill_bundle_version: scenario.skillBundle.version,
    skill_bundle_mode: scenario.skillBundle.mode,
    model_version: scenario.model,
    harness,
    reasoning_effort: "inherit",
    started_at: startedAt,
    wall_time_ms: wallTimeMs,
    funnel_tools_present: funnelToolsPresent,
  }

  const summary: SummaryLine = {
    summary: true,
    funnel: stageRows.filter((r) => r.pass).map((r) => r.stage),
    first_pass_rate: stageRows.filter((r) => r.first_pass).length / STAGES.length,
    recovery_cycles: scored.recovery_cycles,
    parity_verdict: scored.parity_verdict,
    parity_tenant: scored.parity_tenant,
    hygiene_verdict: scored.hygiene_verdict,
    handoff_discipline_verdict: scored.handoff_discipline_verdict,
    tool_calls: transcript.toolCalls.length,
    turns: transcript.turns,
    tokens_in: transcript.tokensIn,
    tokens_out: transcript.tokensOut,
  }

  const recordPath = writeRecord(runId, scenario, meta, stageRows, SKIPPED_STAGES, summary, cli.out)
  for (const note of notes) stderr.write(`WARNING: ${note}\n`)

  if (provisioned && !cli.keepEnv) {
    await teardownEnv(envId, opts)
  }

  const passList = stageRows.filter((r) => r.pass).map((r) => r.stage).join(",")
  stdout.write(`record: ${recordPath}\n`)
  stdout.write(`summary: funnel=[${passList}] first_pass_rate=${summary.first_pass_rate.toFixed(2)} parity=${summary.parity_verdict} hygiene=${summary.hygiene_verdict} handoff=${summary.handoff_discipline_verdict} tool_calls=${summary.tool_calls} turns=${summary.turns} tokens_in=${summary.tokens_in} tokens_out=${summary.tokens_out}\n`)
  return 0
}

main()
  .then((code) => exit(code))
  .catch((err: unknown) => {
    if (err instanceof ReadinessError) {
      stderr.write(`${err.message}\n`)
      exit(2)
    }
    stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`)
    exit(1)
  })
