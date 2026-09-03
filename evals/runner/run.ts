// run.ts — eval runner CLI.
// Usage: node evals/runner/run.ts --scenario <path> [--ref <git-ref>] [--driver <name>] [--out <dir>] [--max-agent-minutes <n>]
// Exit codes: 0 = record written (a scored outcome, even if the agent failed
// stages, timed out, or never wrote the handoff); 2 = readiness failure
// (distinct; NO record written); 1 = any other error.
import {mkdirSync, readFileSync, realpathSync, writeFileSync} from "node:fs"
import {join, resolve} from "node:path"
import {argv, exit, stderr, stdout} from "node:process"
import {pathToFileURL} from "node:url"
import {loadScenario, type Scenario} from "./scenario.ts"
import {FUNNEL_TOOLS, ReadinessError, type AgentDriver, type AgentRunResult, type Driver, type RunChannel, type TenantHandle} from "./driver.ts"
import {buildPrompt} from "./agent.ts"
import {buildCollectorPrompt, normalizeScoreInput} from "./collect.ts"
import {SKIPPED_STAGES, STAGES, handoffEmpty, sanitizeHandoff, type Handoff, type ScoreInput, type StageCtx} from "./stages.ts"
import {scoreRun} from "./score.ts"
import {writeRecord, type RunMeta, type SummaryLine} from "./record.ts"
import {tier0} from "./drivers/tier0/driver.ts"

const DRIVERS: Record<string, Driver> = {tier0}

const COLLECTOR_TIMEOUT_MS = 10 * 60 * 1000

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
    "usage: node evals/runner/run.ts --scenario <path> [--ref <git-ref>] [--driver <name>] [--out <dir>] [--max-agent-minutes <n>]\n",
  )
}

interface CliArgs {
  scenario: string
  ref: string
  driver: string
  out: string
  maxAgentMinutes: number
}

function parseArgs(args: string[]): CliArgs {
  const out: CliArgs = {scenario: "", ref: "", driver: "tier0", out: "evals/results", maxAgentMinutes: 60}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    switch (a) {
      case "--scenario":
        out.scenario = args[++i] ?? ""
        break
      case "--ref":
        out.ref = args[++i] ?? ""
        break
      case "--driver":
        out.driver = args[++i] ?? ""
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
  if (!out.scenario) {
    usage()
    exit(1)
  }
  // --ref is driver-interpreted; restrict to a safe charset (branch/SHA/tag)
  // to prevent shell injection when a driver interpolates it.
  if (out.ref !== "" && !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(out.ref)) {
    stderr.write(`ERROR: invalid --ref: ${out.ref} (must start with a letter or digit, then [A-Za-z0-9._/-]*)\n`)
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

export async function readHandoff(handoffPath: string): Promise<Handoff | null> {
  // Bounded retry: a transient read failure must not be misread as a stalled
  // agent (locked L18). A written-but-empty file is a genuine stall; a
  // missing file is retried (a private driver's transport may lag the write).
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const content = readFileSync(handoffPath, "utf8")
      if (content.length === 0) return null
      let parsed: unknown
      try {
        parsed = JSON.parse(content)
      } catch {
        // A malformed handoff is a genuine stall (the agent wrote garbage) —
        // return null immediately. Never surface the parse error: JSON.parse
        // messages embed a snippet of the offending content, which can carry
        // agent-written values. The warning is content-free so an operator
        // can still distinguish "agent wrote garbage" from "agent never
        // wrote the handoff".
        stderr.write(`WARNING: handoff at ${handoffPath} is not valid JSON — scoring as stalled\n`)
        return null
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
      const handoff = parsed as Handoff
      for (const f of HANDOFF_FIELDS) {
        const v = handoff[f]
        if (typeof v === "string" && isPlaceholder(v)) handoff[f] = ""
      }
      return handoff
    } catch (err) {
      // ENOENT is retried too: a private driver's transport may lag the
      // handoff write (the old read retried every failure). Only a
      // written-but-empty file is an immediate stall.
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

function buildChannel(out: string, runId: string): RunChannel {
  const runDir = join(out, runId)
  return {
    runDir,
    handoffPath: join(runDir, "handoff.json"),
    scoreInputPath: join(runDir, "score-input.json"),
    transcriptPath: join(runDir, "transcript.json"),
    handoffInstructions: "",
    completionInstructions: "",
  }
}

  // Provision + readiness retry loop: 3 attempts, teardown between. The
  // generic tools-present gate (D13) lives here: the scenario's readiness
  // tools must all be in the driver's declared surface, and the record's
  // funnel_tools_present is derived from that surface against FUNNEL_TOOLS —
  // never from a driver assertion.
export async function provisionWithRetry(
  driver: Driver,
  scenario: Scenario,
  runId: string,
  ref: string,
): Promise<{handle: TenantHandle; funnelToolsPresent: boolean}> {
  let handle: TenantHandle | null = null
  for (let i = 0; i < 3; i++) {
    try {
      const h = await driver.provisioner.provision({scenario, runId, ref})
      handle = h
      await driver.provisioner.checkReadiness(h)
      const missing = scenario.readinessTools.filter((t) => !h.toolSurface.includes(t))
      if (missing.length > 0) throw new ReadinessError("missing readiness tools: " + missing.join(", "))
      const funnelToolsPresent = FUNNEL_TOOLS.every((t) => h.toolSurface.includes(t))
      return {handle: h, funnelToolsPresent}
    } catch (err) {
      if (handle) {
        try {
          await driver.provisioner.teardown(handle)
        } catch {
          /* best-effort */
        }
        handle = null
      }
      if (i === 2) throw err
      console.error(`attempt ${i + 1}/3 failed: ${(err as Error).message}`)
    }
  }
  throw new Error("unreachable")
}

// Collect the score-input through the driver, with a bounded 2-attempt retry
// (a transient collector failure must not discard a full run). On the
// stalled path (handoff COMPLETELY absent) a final collector failure still
// produces a null score-input record (exit 0); a partial handoff + collector
// failure is a real infrastructure failure and rethrows (exit 1, no record).
export async function collectScoreInput(
  driver: AgentDriver,
  scenario: Scenario,
  runId: string,
  channel: RunChannel,
  handoffPath: string,
  handoff: Handoff,
  toolSurface: string[],
  handoffOk: boolean,
  ref: string,
  retryBackoffMs = 5000,
): Promise<{scoreInput: ScoreInput; notes: string[]}> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await driver.runAgent({
        kind: "collector",
        prompt: buildCollectorPrompt(scenario, runId, handoffPath, channel.scoreInputPath, handoff, toolSurface),
        toolSurface,
        channel,
        timeoutMs: COLLECTOR_TIMEOUT_MS,
        model: scenario.model,
        ref,
      })
      // Read the file OUTSIDE the redacting try: an ENOENT (the collector
      // never wrote score-input.json) is an infrastructure failure whose
      // message carries only a path — surface it. Only JSON.parse errors are
      // redacted: their messages embed a snippet of the offending content,
      // which can carry connector secrets.
      const rawText = readFileSync(channel.scoreInputPath, "utf8")
      let raw: unknown
      try {
        raw = JSON.parse(rawText)
      } catch {
        throw new Error("collector produced an unreadable score-input")
      }
      const normalized = normalizeScoreInput(raw)
      return {scoreInput: normalized.scoreInput, notes: normalized.notes}
    } catch (err) {
      lastErr = err
      if (attempt < 2) {
        console.warn(`WARNING: collector attempt ${attempt}/2 failed (${(err as Error).message}) — retrying`)
        await new Promise<void>((resolve) => setTimeout(resolve, retryBackoffMs))
      }
    }
  }
  if (handoffOk || !handoffEmpty(handoff)) throw lastErr
  stderr.write(`WARNING: collector failed on the stalled path (${(lastErr as Error).message}) — writing a null score-input record\n`)
  return {
    scoreInput: {
      run_id: runId,
      draft: {required_source_files: {}, source_files: [], config_schema: {fields: []}, runtime_schema: {fields: []}},
      connector_config: {},
      evidence: {},
      build_run: {},
      tenant_counts: {users: null, groups: null, memberships: null},
      resource_ids: {users: [], groups: []},
    },
    notes: [],
  }
}

// A driver-reported collection failure with an empty stream is an
// infrastructure outage, not an agent outcome — the runner must not score it
// as an all-fail funnel. A genuine zero-tool-call stall (no collectionFailed
// signal) stays a scored exit-0 outcome, and a timed-out run always scores
// its partial stream.
export function isCollectionFailure(result: AgentRunResult): boolean {
  return result.transcript.toolCalls.length === 0 && !result.timedOut && result.collectionFailed === true
}

async function main(): Promise<number> {
  const cli = parseArgs(argv.slice(2))
  const scenario = loadScenario(cli.scenario)
  const driver = Object.hasOwn(DRIVERS, cli.driver) ? DRIVERS[cli.driver] : undefined
  if (driver === undefined) {
    stderr.write(`ERROR: unknown driver: ${cli.driver} (available: ${Object.keys(DRIVERS).join(", ")})\n`)
    exit(1)
  }

  const runId = runIdFor(scenario, new Date())
  const startedAt = new Date().toISOString()
  const channel = buildChannel(cli.out, runId)
  const {handoffInstructions, completionInstructions} = driver.channelInstructions(channel)
  channel.handoffInstructions = handoffInstructions
  channel.completionInstructions = completionInstructions
  mkdirSync(channel.runDir, {recursive: true})

  // Provision + readiness retry loop: 3 attempts, teardown between.
  const {handle, funnelToolsPresent} = await provisionWithRetry(driver, scenario, runId, cli.ref)

  try {
    const prompt = buildPrompt(scenario, runId, handle.baseUrl, channel)
    const result = await driver.agentDriver.runAgent({
      kind: "agent",
      prompt,
      toolSurface: handle.toolSurface,
      channel,
      timeoutMs: cli.maxAgentMinutes * 60 * 1000,
      model: scenario.model,
      ref: cli.ref,
    })
    const {transcript, timedOut, wallTimeMs} = result
    if (timedOut) {
      stderr.write(`WARNING: agent run did not complete within ${cli.maxAgentMinutes} min — scoring the partial stream\n`)
    }
    // A driver-reported collection failure with an empty stream is an
    // infrastructure outage, not an agent outcome — fail loudly with no
    // record rather than scoring an all-fail funnel. A genuine zero-tool-call
    // stall (no collectionFailed signal) stays a scored exit-0 outcome.
    if (isCollectionFailure(result)) {
      throw new Error("agent driver reported a stream collection failure with an empty transcript — no record written")
    }

    // Handoff: missing/incomplete -> L18 stalled-agent path.
    const handoff = (await readHandoff(channel.handoffPath)) ?? {}
    const handoffOk = handoffComplete(handoff)
    if (!handoffOk) {
      stderr.write(`WARNING: handoff.json missing or incomplete at ${channel.handoffPath} — stalled-agent path\n`)
    }

    // The agent-written handoff is UNTRUSTED. The collector reads it from the
    // run channel as a tool result — strip characters that could inject
    // instructions into the collector's transcription (quotes, braces,
    // semicolons, control chars) and coerce non-string fields to empty, then
    // write a sanitized copy for it.
    const sanitizedHandoff = sanitizeHandoff(handoff)
    const sanitizedHandoffPath = join(channel.runDir, "handoff-sanitized.json")
    // Fatal, not a warning: if the sanitized copy cannot be written, the
    // collector would read a nonexistent file, record nulls, and the run
    // would be written as a scored record — an infrastructure failure
    // recorded as an agent outcome. Rethrow -> exit 1, no record.
    writeFileSync(sanitizedHandoffPath, JSON.stringify(sanitizedHandoff))

    // Collect. On the stalled path (no handoff at all), a collector failure
    // must still produce a scored record (exit 0) — the plan's exit-0
    // contract for stalled agents; on a real run, collector failure is an
    // infrastructure error (exit 1, documented). The bounded retry + the
    // stalled-path fallback live in collectScoreInput.
    const collected = await collectScoreInput(driver.agentDriver, scenario, runId, channel, sanitizedHandoffPath, handoff, handle.toolSurface, handoffOk, cli.ref)
    const scoreInput = collected.scoreInput
    const collectNotes = collected.notes

    const ctx: StageCtx = {transcript, handoff, scoreInput, handoffPath: channel.handoffPath}
    const scored = scoreRun(ctx)
    const stageRows = scored.stageRows

    // Run meta: harness = driver name; Tier-0 has no reasoning-effort knob.
    const meta: RunMeta = {
      run_id: runId,
      scenario: scenario.id,
      skill_bundle_version: scenario.skillBundle.version,
      skill_bundle_mode: scenario.skillBundle.mode,
      model_version: scenario.model,
      harness: driver.name,
      reasoning_effort: "n/a",
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
      parity_evidence: scored.parity_evidence,
      parity_tenant: scored.parity_tenant,
      parity_tenant_evidence: scored.parity_tenant_evidence,
      hygiene_verdict: scored.hygiene_verdict,
      hygiene_evidence: scored.hygiene_evidence,
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
    // Teardown on EVERY exit path (success or error).
    if (handle) {
      try {
        await driver.provisioner.teardown(handle)
      } catch {
        /* best-effort */
      }
    }
  }
}

// Only run the CLI when this file is the entry point — importing run.ts from
// tests must not execute main() (the registry stays private; the exported
// helpers are exercised directly).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
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
}
