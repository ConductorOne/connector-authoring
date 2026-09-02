// run.ts — eval runner CLI (CXF-216 PR 1, L18).
// Usage: node evals/runner/run.ts --scenario <path> --ref <git-ref>
//   [--task-id <id>] [--env <env-id>] [--keep-env] [--out <dir>] [--max-agent-minutes <n>]
// Exit codes: 0 = record written (a scored outcome, even if the agent failed
// stages, timed out, or never wrote the handoff); 2 = readiness failure
// (distinct; NO record written); 1 = any other error.
import {argv, exit, stderr, stdout} from "node:process"
import {call, fsRead, fsWrite, resolveTaskId, taskStream, type CallOpts} from "./squire.ts"
import {loadScenario, type Scenario} from "./scenario.ts"
import {provisionEnv, retryProvision, teardownEnv} from "./provision.ts"
import {ReadinessError, waitForReady} from "./readiness.ts"
import {installFixture} from "./fixture-install.ts"
import {buildPrompt, createAgentTask, waitForAgentTask} from "./agent.ts"
import {parseStream, pollStreamIncrementally} from "./stream.ts"
import {collect} from "./collect.ts"
import {SKIPPED_STAGES, STAGES, handoffEmpty, sanitizeHandoff, type Handoff, type ScoreInput, type StageCtx} from "./stages.ts"
import {scoreRun} from "./score.ts"
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
      case "--env": {
        const v = args[++i] ?? ""
        if (v === "") {
          stderr.write("ERROR: --env requires a non-empty value\n")
          exit(1)
        }
        out.env = v
        break
      }
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
        exit(0)
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
  // --ref is interpolated into the eval-env setup script; restrict to a safe
  // charset (branch/SHA/tag) to prevent shell injection (locked L26).
  if (!/^[A-Za-z0-9._/-]+$/.test(out.ref)) {
    stderr.write(`ERROR: invalid --ref: ${out.ref} (must match [A-Za-z0-9._/-]+)\n`)
    exit(1)
  }
  return out
}

function runIdFor(scenario: Scenario, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  // Millisecond suffix keeps same-second runs distinct (locked L19).
  return `evals-${scenario.id}-${stamp}-${String(now.getUTCMilliseconds()).padStart(3, "0")}`
}

function handoffComplete(h: Handoff): boolean {
  return HANDOFF_FIELDS.every((f) => typeof h[f] === "string" && (h[f] as string).length > 0)
}

// Reject template placeholders like <catalog_id> — an unsubstituted handoff
// must not false-pass S1/S4/S6/S7/S9 (locked L23).
function isPlaceholder(v: string): boolean {
  return v.length >= 3 && v.startsWith("<") && v.endsWith(">")
}

async function readHandoff(handoffPath: string, opts: CallOpts): Promise<Handoff | null> {
  // Bounded retry: a transient read failure must not be misread as a stalled
  // agent (locked L18). A clean absent/empty result is a genuine stall.
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = (await fsRead(handoffPath, opts)) as Record<string, unknown>
      const content = res.content as string | undefined
      if (typeof content !== "string" || content.length === 0) return null
      const parsed = JSON.parse(content) as unknown
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
      const handoff = parsed as Handoff
      for (const f of HANDOFF_FIELDS) {
        const v = handoff[f]
        if (typeof v === "string" && isPlaceholder(v)) handoff[f] = ""
      }
      return handoff
    } catch (err) {
      lastErr = err
      if (attempt < 3) {
        await new Promise<void>((resolve) => setTimeout(resolve, 2000))
      }
    }
  }
  stderr.write(`WARNING: handoff read failed after 3 attempts: ${(lastErr as Error).message} — scoring as stalled\n`)
  return null
}

// L18 stalled-agent path is applied inside scoreRun (a completely absent
// handoff fails S1..S10 with the locked evidence; a partial handoff is
// scored from each stage's own evidence).


// --env mode targets an existing env; verify the caller owns it before
// creating tasks / writing arena files there (IDOR hardening). Fail-closed:
// an absent/undefined is_mine must NOT pass.
async function assertEnvOwned(envId: string, opts: CallOpts): Promise<void> {
  const env = (await call("get_env", {env_id: envId}, opts)) as Record<string, unknown> | null
  if (env === null || env.is_mine !== true) {
    throw new Error(`refusing --env ${envId}: env ownership not verified (is_mine=${String(env?.is_mine ?? "unavailable")})`)
  }
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
  let baseUrl = ""
  let funnelToolsPresent = false
  if (provisioned) {
    const {envId: e} = await retryProvision(
      scenario,
      runId,
      async (eid) => {
        const r = await waitForReady(eid, scenario, runId, opts)
        funnelToolsPresent = r.funnelToolsPresent
        const installed = await installFixture(eid, scenario, runId, cli.ref, opts)
        baseUrl = installed.baseUrl
      },
      3,
      opts,
    )
    envId = e
  } else {
    const existingEnv = cli.env
    if (!existingEnv) throw new Error("--env requires a non-empty value")
    envId = existingEnv
    await assertEnvOwned(envId, opts)
    // --env mode: single readiness attempt, no retries, no teardown.
    const r = await waitForReady(envId, scenario, runId, opts)
    funnelToolsPresent = r.funnelToolsPresent
    const installed = await installFixture(envId, scenario, runId, cli.ref, opts)
    baseUrl = installed.baseUrl
  }

  try {
    const prompt = buildPrompt(scenario, runId, baseUrl, cli.ref)
    const {taskId: agentTaskId} = await createAgentTask(envId, scenario, runId, prompt, opts)

    // Wait with the --max-agent-minutes bound while the firehose accumulates.
    let stopPolling = false
    const streamEvents: unknown[] = []
    const poller = pollStreamIncrementally(
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
    const {lastSeq, pollErrors} = await poller
// final drain: catch anything appended after the last cursor (a
    // transient hiccup here must not abort a completed run).
    let tailEvents: unknown[] = []
    let drainFailed = false
    try {
      const tail = (await taskStream(agentTaskId, {sinceSeq: lastSeq, limit: 500}, opts)) as Record<string, unknown>
      tailEvents = (tail.events ?? []) as unknown[]
    } catch (err) {
      drainFailed = true
      stderr.write(`WARNING: final task.stream drain failed: ${(err as Error).message}\n`)
    }
    if (tailEvents.length > 0) streamEvents.push(...tailEvents)
    if (timedOut) {
      stderr.write(`WARNING: agent task ${agentTaskId} did not reach terminal within ${cli.maxAgentMinutes} min — scoring the partial stream\n`)
    }

    const transcript = parseStream(streamEvents)
    // A terminal agent with an EMPTY transcript, stream poll errors, AND a
    // failed final drain is an infrastructure outage, not a scored agent
    // outcome — fail loudly with no record rather than scoring an all-fail
    // funnel. A single transient poll error with a working drain still
    // scores (a genuinely stalled agent is a legitimate all-fail outcome).
    if (transcript.toolCalls.length === 0 && pollErrors > 0 && drainFailed) {
      throw new Error(`agent task ${agentTaskId} reached terminal but the firehose was unreadable (${pollErrors} stream poll failures, final drain failed) — no record written`)
    }

// Handoff: missing/incomplete -> L18 stalled-agent path.
    const handoff = (await readHandoff(handoffPath, opts)) ?? {}
    const handoffOk = handoffComplete(handoff)
    if (!handoffOk) {
      stderr.write(`WARNING: handoff.json missing or incomplete at ${handoffPath} — stalled-agent path\n`)
    }

// The agent-written handoff is UNTRUSTED. The collector reads it from the
    // arena FS as a tool result — strip characters that could inject
    // instructions into the collector's transcription (quotes, braces,
    // semicolons, control chars) and coerce non-string fields to empty, then
    // write a sanitized copy for it.
    const sanitizedHandoff = sanitizeHandoff(handoff)
    const sanitizedHandoffPath = handoffPath.replace("handoff.json", "handoff-sanitized.json")
    // Fatal, not a warning: if the sanitized copy cannot be written, the
    // collector would read a nonexistent file, record nulls, and the run
    // would be written as a scored record — an infrastructure failure
    // recorded as an agent outcome. Rethrow -> exit 1, no record.
    await fsWrite(sanitizedHandoffPath, JSON.stringify(sanitizedHandoff), opts)

    // Collect. On the stalled path (no handoff at all), a collector failure
    // must still produce a scored record (exit 0) — the plan's exit-0
    // contract for stalled agents; on a real run, collector failure is an
    // infrastructure error (exit 1, documented).
    let scoreInput: ScoreInput
    let collectNotes: string[] = []
    try {
      const collected = await collect(envId, scenario, runId, sanitizedHandoffPath, handoff, opts)
      scoreInput = collected.scoreInput
      collectNotes = collected.notes
} catch (err) {
      // The exit-0 contract for stalled agents applies only when the handoff
      // is COMPLETELY absent; a partial handoff + collector failure is a real
      // infrastructure failure and must not be masked by a null record.
      if (handoffOk || !handoffEmpty(handoff)) throw err
      stderr.write(`WARNING: collector failed on the stalled path (${(err as Error).message}) — writing a null score-input record\n`)
      scoreInput = {
        run_id: runId,
        draft: {required_source_files: {}, source_files: [], config_schema: {fields: []}, runtime_schema: {fields: []}},
        connector_config: {},
        evidence: {},
        build_run: {},
        tenant_counts: {users: null, groups: null, memberships: null},
        resource_ids: {users: [], groups: []},
      }
    }

const ctx: StageCtx = {transcript, handoff, scoreInput, handoffPath}
    const scored = scoreRun(ctx)
    const stageRows = scored.stageRows

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
    for (const note of collectNotes) stderr.write(`WARNING: ${note}\n`)

    const passList = stageRows.filter((r) => r.pass).map((r) => r.stage).join(",")
    stdout.write(`record: ${recordPath}\n`)
    stdout.write(`summary: funnel=[${passList}] first_pass_rate=${summary.first_pass_rate.toFixed(2)} parity=${summary.parity_verdict} hygiene=${summary.hygiene_verdict} handoff=${summary.handoff_discipline_verdict} tool_calls=${summary.tool_calls} turns=${summary.turns} tokens_in=${summary.tokens_in} tokens_out=${summary.tokens_out}\n`)
    return 0
  } finally {
    // Teardown on EVERY exit path (success or error) for provisioned envs,
    // unless --keep-env. --env mode never tears down an env it did not create.
    if (provisioned && !cli.keepEnv) {
      await teardownEnv(envId, opts)
    }
  }
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
