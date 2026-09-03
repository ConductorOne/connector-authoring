// drivers/tier0/driver.ts — Tier-0 local/static driver (no credentials).
import {spawn, type ChildProcess} from "node:child_process"
import {readFileSync, writeFileSync} from "node:fs"

import {join} from "node:path"
import {cwd} from "node:process"
import {fileURLToPath} from "node:url"
import {FUNNEL_TOOLS, ReadinessError, type AgentDriver, type Driver, type Provisioner, type RunChannel, type TenantHandle} from "../../driver.ts"
import {parseStream, type ParsedStream} from "../../stream.ts"

const FIXTURE_SCRIPT = fileURLToPath(new URL("../../../fixture/server.ts", import.meta.url))
const CANNED_DIR = fileURLToPath(new URL(".", import.meta.url))
const readCanned = (name: string) => readFileSync(join(CANNED_DIR, name), "utf8")

// The full 14-tool funnel PLUS the two remaining core readiness tools
// (get_authoring_guide, create_draft) — 16 unique names; the scenario's five
// readinessTools are a subset, so the runner's generic tools-present gate
// passes and funnel_tools_present is true.
export const TIER0_TOOL_SURFACE: string[] = [
  ...FUNNEL_TOOLS,
  "c1_connector_authoring_get_authoring_guide",
  "c1_connector_authoring_create_draft",
]

// The fixture binds port 0 (OS-assigned) and reports the bound port on
// stdout — no pre-reservation gap, so concurrent provisions cannot collide
// on EADDRINUSE (the old findFreePort released the port before the spawn).
async function waitForFixturePort(child: ChildProcess, spawnFailed: () => boolean): Promise<number> {
  const deadline = Date.now() + 10_000
  let port: number | null = null
  // Accumulate stdout: the port line can arrive split across chunk
  // boundaries — matching each chunk in isolation would lose it.
  let buf = ""
  child.stdout?.on("data", (chunk) => {
    // Only accumulate while the port is unknown: the fixture logs every
    // request to stdout, so an unbounded buffer would retain the whole
    // request log and re-scan it on each chunk. The listener stays attached
    // to keep draining the pipe (the child is spawned with stdio pipe).
    if (port === null) {
      buf += String(chunk)
      const m = /fixture listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(buf)
      if (m) port = Number(m[1])
    }
  })
  while (Date.now() < deadline && port === null) {
    if (spawnFailed()) {
      throw new ReadinessError("fixture spawn failed (see warning above)")
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new ReadinessError(`fixture exited before reporting its port (code ${child.exitCode ?? "signal " + child.signalCode})`)
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  if (port === null) throw new ReadinessError("fixture did not report a bound port within 10 s")
  return port
}

async function waitForFixture(baseUrl: string, expectedUsers: number): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl + "/v1/users?account_id=acct-1", {
        headers: {authorization: "Basic " + Buffer.from("connector@example.com:fixture-token").toString("base64")},
        // Bound each probe: a peer that accepts but never responds must not
        // hang past the deadline (the deadline is only checked between
        // iterations).
        signal: AbortSignal.timeout(2_000),
      })
      const body = await res.text()
      // Parse the JSON and compare the total numerically — a literal
      // substring match would hardcode the fixture seed and its exact JSON
      // serialization, failing closed as a generic timeout on any change.
      let total: number | null = null
      try {
        const parsed = JSON.parse(body) as {total?: unknown}
        total = typeof parsed.total === "number" ? parsed.total : null
      } catch {
        /* not JSON yet — retry */
      }
      if (total === expectedUsers) return
    } catch {
      /* server not up yet — retry */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new ReadinessError(`fixture not reachable at ${baseUrl} within 30 s (expected ${expectedUsers} users)`)
}

const provisioner: Provisioner = {
  provision: async (ctx) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", FIXTURE_SCRIPT, "--port", "0", "--host", "127.0.0.1"], {cwd: cwd(), stdio: ["ignore", "pipe", "ignore"]})
    // A spawn failure (e.g. ENOENT on the node binary) emits 'error' on the
    // child; without a listener it would crash the runner. Log it and flag
    // it so the port poll fails fast instead of burning the 10 s deadline.
    let spawnFailed = false
    child.on("error", (err) => {
      spawnFailed = true
      console.error(`WARNING: fixture spawn failed: ${err.message}`)
    })
    let port: number
    try {
      port = await waitForFixturePort(child, () => spawnFailed)
    } catch (err) {
      // Reap the child: provision never returns a handle, so provisionWithRetry
      // cannot teardown it — an orphaned fixture would keep its listening
      // socket past the runner's exit.
      child.kill()
      throw err
    }
    const baseUrl = "http://127.0.0.1:" + port
    return {baseUrl, credentials: {username: "connector@example.com", password: "fixture-token"}, toolSurface: TIER0_TOOL_SURFACE, meta: {child, port, expectedUsers: ctx.scenario.seed.users}}
  },
  checkReadiness: async (handle) => {
    // Fail fast if the fixture child already exited (spawn error or crash) —
    // a specific error beats a generic 30 s timeout.
    const child = (handle.meta?.child as ChildProcess | undefined)
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new ReadinessError(`fixture exited before readiness (code ${child.exitCode ?? "signal " + child.signalCode})`)
    }
    await waitForFixture(handle.baseUrl, (handle.meta?.expectedUsers as number | undefined) ?? 23)
  },
  teardown: async (handle) => {
    const child = (handle.meta?.child as ChildProcess | undefined)
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill()
      await Promise.race([new Promise((r) => child.once("exit", r)), new Promise((r) => setTimeout(r, 2000))])
    }
  },
}

function emptyParsedStream(): ParsedStream {
  return {toolCalls: [], turns: 1, tokensIn: null, tokensOut: null, errors: [], stageAttempts: {}, stageFailures: {}, recoveryCycles: 0}
}

const agentDriver: AgentDriver = {
  runAgent: async (req) => {
    const startedAt = Date.now()
    if (req.kind === "agent") {
      const raw = JSON.parse(readCanned("transcript.json")) as Record<string, unknown>[]
      // Deep copy: the <run-dir> substitution must never mutate the canned file.
      const events = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>[]
      for (const ev of events) {
        const input = (ev.data as Record<string, unknown> | undefined)?.input as Record<string, unknown> | undefined
        if (input && typeof input.path === "string") input.path = input.path.replaceAll("<run-dir>", req.channel.runDir)
      }
      writeFileSync(req.channel.transcriptPath, JSON.stringify(events, null, 2))
      writeFileSync(req.channel.handoffPath, readCanned("handoff.json"))
      return {transcript: parseStream(events), timedOut: false, wallTimeMs: Date.now() - startedAt}
    }
    writeFileSync(req.channel.scoreInputPath, readCanned("score-input.json"))
    return {transcript: emptyParsedStream(), timedOut: false, wallTimeMs: Date.now() - startedAt}
  },
}

export const tier0: Driver = {
  name: "tier0",
  provisioner,
  agentDriver,
  channelInstructions: (channel) => ({
    handoffInstructions: "Write it with driver.write_file: args {path: \"" + channel.handoffPath + "\", content: \"<the full handoff JSON>\"}.",
    completionInstructions: "Then terminate the run with driver.complete_run: args {summary: \"handoff written; funnel complete to human-activation boundary\"}.",
  }),
}
