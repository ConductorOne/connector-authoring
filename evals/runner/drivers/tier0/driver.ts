// drivers/tier0/driver.ts — Tier-0 local/static driver (no credentials).
import {spawn, type ChildProcess} from "node:child_process"
import {readFileSync, writeFileSync} from "node:fs"
import {createServer, type AddressInfo} from "node:net"
import {join} from "node:path"
import {cwd} from "node:process"
import {fileURLToPath} from "node:url"
import {type AgentDriver, type AgentRunRequest, type AgentRunResult, type Driver, type Provisioner, type RunChannel, type TenantHandle, ReadinessError} from "../../driver.ts"
import {parseStream, type ParsedStream} from "../../stream.ts"

const FIXTURE_SCRIPT = fileURLToPath(new URL("../../../fixture/server.ts", import.meta.url))
const CANNED_DIR = fileURLToPath(new URL(".", import.meta.url))
const readCanned = (name: string) => readFileSync(join(CANNED_DIR, name), "utf8")

// The full 14-tool funnel PLUS the two remaining core readiness tools
// (get_authoring_guide, create_draft) — 16 unique names. The scenario's five
// readinessTools are a subset, so the runner's generic tools-present gate
// passes and funnelToolsPresent is true (D13).
export const TIER0_TOOL_SURFACE: string[] = [
  "c1_connector_authoring_create_draft_source_upload",
  "c1_connector_authoring_finalize_draft_source_upload",
  "c1_connector_authoring_get_draft",
  "c1_connector_authoring_build_bundle",
  "c1_connector_authoring_get_run",
  "c1_apps_create",
  "c1_connector_authoring_provision_connector",
  "c1_connector_service_get",
  "c1_connector_service_update",
  "c1_connector_authoring_run_draft_test_sync",
  "c1_connector_authoring_get_test_run_evidence",
  "c1_connector_authoring_deploy_connector_instance",
  "c1_connector_authoring_mint_approval_token",
  "c1_connector_authoring_list_revision_summaries",
  "c1_connector_authoring_get_authoring_guide",
  "c1_connector_authoring_create_draft",
]

// Ephemeral-port probe: net.createServer().listen(0) picks a free port, then
// close it and hand the port to the fixture child (decision 8).
async function findFreePort(): Promise<number> {
  const server = createServer()
  const listen = Promise.withResolvers<void>()
  server.listen(0, listen.resolve)
  await listen.promise
  // server.address() is string | AddressInfo | null; a listening TCP server
  // always reports AddressInfo (strict TS requires the cast).
  const port = (server.address() as AddressInfo).port
  const closed = Promise.withResolvers<void>()
  server.close(() => closed.resolve())
  await closed.promise
  return port
}

// Bounded poll: the fixture takes a moment to start listening, so fetch
// errors are retried (never a hard failure) until the authenticated
// /v1/users?account_id=acct-1 response carries "total":23 (decision 8).
async function waitForFixture(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl + "/v1/users?account_id=acct-1", {
        headers: {authorization: "Basic " + Buffer.from("connector@example.com:fixture-token").toString("base64")},
      })
      const body = await res.text()
      if (body.includes('"total":23')) return
    } catch {
      // server not up yet — retry
    }
const sleep = Promise.withResolvers<void>()
    setTimeout(sleep.resolve, 500)
    await sleep.promise
  }
  throw new ReadinessError("fixture not reachable at " + baseUrl + " within 30 s")
}

const provisioner: Provisioner = {
  provision: async (ctx) => {
    const port = await findFreePort()
    const child = spawn(process.execPath, ["--experimental-strip-types", FIXTURE_SCRIPT, "--port", String(port), "--host", "127.0.0.1"], {cwd: cwd(), stdio: "ignore"})
    const baseUrl = "http://127.0.0.1:" + port
    return {baseUrl, credentials: {username: "connector@example.com", password: "fixture-token"}, toolSurface: TIER0_TOOL_SURFACE, meta: {child, port}}
  },
  checkReadiness: async (handle) => {
    await waitForFixture(handle.baseUrl)
    return {funnelToolsPresent: true}
  },
  teardown: async (handle) => {
    // meta.child is the ChildProcess we stored in provision (unchecked cast
    // of a known shape; runtime-checked below).
    const child = handle.meta?.child as ChildProcess | undefined
if (child && child.exitCode === null) {
      child.kill()
      const exited = Promise.withResolvers<void>()
      child.once("exit", () => exited.resolve())
      const timeout = Promise.withResolvers<void>()
      setTimeout(timeout.resolve, 2000)
      await Promise.race([exited.promise, timeout.promise])
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
      // Deep copy, then substitute the <run-dir> placeholder in every
      // driver.write_file input.path so the S11 gate's exact
      // args.path === channel.handoffPath match holds at runtime (D15).
      const events = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>[]
      for (const ev of events) {
        const data = ev.data
        if (typeof data !== "object" || data === null) continue
        const input = "input" in data ? data.input : undefined
        if (typeof input !== "object" || input === null) continue
        if ("path" in input && typeof input.path === "string") {
          input.path = input.path.replaceAll("<run-dir>", req.channel.runDir)
        }
      }
      writeFileSync(req.channel.transcriptPath, JSON.stringify(events, null, 2))
      writeFileSync(req.channel.handoffPath, readCanned("handoff.json"))
      return {transcript: parseStream(events), timedOut: false, wallTimeMs: Date.now() - startedAt}
    }
    // collector: replay the canned score-input into the run channel.
    writeFileSync(req.channel.scoreInputPath, readCanned("score-input.json"))
    return {transcript: emptyParsedStream(), timedOut: false, wallTimeMs: Date.now() - startedAt}
  },
}

export const tier0: Driver = {
  name: "tier0",
  provisioner,
  agentDriver,
  channelInstructions: (channel) => ({
    handoffInstructions: 'Write it with driver.write_file: args {path: "' + channel.handoffPath + '", content: "<the full handoff JSON>"}.',
    completionInstructions: 'Then terminate the run with driver.complete_run: args {summary: "handoff written; funnel complete to human-activation boundary"}.',
  }),
}
