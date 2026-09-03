// run.test.ts — CLI contract smoke for the runner (locked E1/L18).
// The exit-code contract and the --ref injection guard are security-relevant
// and must not regress: --help exits 0, missing required args exit 1, an
// invalid --ref exits 1 with a clear error, an unknown --driver exits 1, a
// readiness failure exits 2 with no record. The locked runner contracts
// (3-attempt provision retry with teardown between, the generic tools-present
// gate, the stalled-path null score-input fallback) are exercised directly
// against the exported helpers with fake drivers.
import {test} from "node:test"
import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {promisify} from "node:util"
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {collectScoreInput, isCollectionFailure, provisionWithRetry, readHandoff} from "./run.ts"
import {FUNNEL_TOOLS, ReadinessError, type AgentDriver, type Driver, type Provisioner, type RunChannel, type TenantHandle} from "./driver.ts"
import type {ParsedStream} from "./stream.ts"
import type {Scenario} from "./scenario.ts"
import type {Handoff} from "./stages.ts"

const execFileAsync = promisify(execFile)
const RUN = "evals/runner/run.ts"

async function runCli(args: string[], timeoutMs = 30_000): Promise<{code: number; stdout: string; stderr: string}> {
  try {
    const {stdout, stderr} = await execFileAsync("node", ["--experimental-strip-types", RUN, ...args], {
      cwd: process.cwd(),
      timeout: timeoutMs,
    })
    return {code: 0, stdout, stderr}
  } catch (err) {
    const e = err as {code?: number; stdout?: string; stderr?: string}
    return {code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? ""}
  }
}

const SCENARIO: Scenario = {
  id: "tier1-directory",
  name: "Tier 1: Directory API sync funnel",
  fixture: {
    port: 18080,
    baseUrl: "http://127.0.0.1:18080",
    auth: "basic",
    openapiPath: "/openapi.json",
    basicAuth: {username: "connector@example.com", password: "fixture-token"},
    bearerToken: "fixture-token",
  },
  seed: {users: 23, groups: 5, memberships: 23, nullTitleUsers: 3, unscopedSubset: 3, disabledUsers: 2},
  expected: {users: 23, groups: 5, memberships: 23},
  skillBundle: {mode: "none", version: "0.0.0"},
  model: "together/deepseek-ai/DeepSeek-V4-Flash-0731",
  requiredSourceFiles: ["connector.ts", "config-schema.json", "runtime-schema.json", "capabilities.json"],
  readinessTools: [
    "c1_connector_authoring_get_authoring_guide",
    "c1_connector_authoring_create_draft",
    "c1_connector_authoring_build_bundle",
    "c1_connector_authoring_run_draft_test_sync",
    "c1_connector_authoring_get_test_run_evidence",
  ],
}

function emptyStream(): ParsedStream {
  return {toolCalls: [], turns: 1, tokensIn: null, tokensOut: null, errors: [], stageAttempts: {}, stageFailures: {}, recoveryCycles: 0}
}

function makeDriver(provisioner: Provisioner): Driver {
  return {
    name: "fake",
    provisioner,
    agentDriver: {
      runAgent: async () => ({transcript: emptyStream(), timedOut: false, wallTimeMs: 0}),
    },
    channelInstructions: () => ({handoffInstructions: "", completionInstructions: ""}),
  }
}

function fullSurface(): string[] {
  return [...FUNNEL_TOOLS, ...SCENARIO.readinessTools]
}

function makeChannel(dir: string): RunChannel {
  return {
    runDir: dir,
    handoffPath: join(dir, "handoff.json"),
    scoreInputPath: join(dir, "score-input.json"),
    transcriptPath: join(dir, "transcript.json"),
    handoffInstructions: "",
    completionInstructions: "",
  }
}

test("--help exits 0 with usage", async () => {
  const {code, stdout, stderr} = await runCli(["--help"])
  assert.equal(code, 0)
  assert.ok((stdout + stderr).includes("usage: node evals/runner/run.ts"))
})

test("missing --scenario exits 1", async () => {
  const {code} = await runCli([])
  assert.equal(code, 1)
})

test("an invalid --ref (shell metacharacters) exits 1 with a clear error", async () => {
  const {code, stderr} = await runCli(["--scenario", "evals/scenarios/tier1-directory.json", "--ref", "bad;rm -rf /"])
  assert.equal(code, 1)
  assert.ok(stderr.includes("invalid --ref"))
})

test("an unknown --driver exits 1 with a clear error", async () => {
  const {code, stderr} = await runCli(["--scenario", "evals/scenarios/tier1-directory.json", "--driver", "nope"])
  assert.equal(code, 1)
  assert.ok(stderr.includes("unknown driver"))
})

test("readiness failure (missing tool) exits 2 with no record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "run-exit2-"))
  try {
    const scenarioPath = join(dir, "scenario.json")
    const base = JSON.parse(readFileSync("evals/scenarios/tier1-directory.json", "utf8")) as Record<string, unknown>
    const tools = base.readinessTools as string[]
    base.readinessTools = [...tools.slice(0, 4), "c1_connector_authoring_nonexistent_tool"]
    writeFileSync(scenarioPath, JSON.stringify(base))
    const outDir = join(dir, "out")
    const {code, stderr} = await runCli(["--scenario", scenarioPath, "--driver", "tier0", "--out", outDir], 120_000)
    assert.equal(code, 2)
    assert.ok(stderr.includes("READINESS FAILURE"), `expected READINESS FAILURE, got stderr=${stderr}`)
    assert.ok(stderr.includes("missing readiness tools"))
    assert.equal(readdirSync(outDir).filter((f) => f.endsWith(".jsonl")).length, 0)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("provisionWithRetry succeeds on the first attempt and derives funnel_tools_present from the declared surface", async () => {
  const handle: TenantHandle = {baseUrl: "http://x", credentials: {}, toolSurface: fullSurface()}
  let teardowns = 0
  let receivedRef = ""
  const driver = makeDriver({
    provision: async (ctx) => {
      receivedRef = ctx.ref
      return handle
    },
    checkReadiness: async () => {},
    teardown: async () => {
      teardowns++
    },
  })
  const {handle: h, funnelToolsPresent} = await provisionWithRetry(driver, SCENARIO, "r", "main")
  assert.equal(h, handle)
  assert.equal(funnelToolsPresent, true)
  assert.equal(receivedRef, "main")
  assert.equal(teardowns, 0)
})

test("provisionWithRetry retries after a readiness failure and tears down between attempts", async () => {
  const h1: TenantHandle = {baseUrl: "http://x1", credentials: {}, toolSurface: fullSurface()}
  const h2: TenantHandle = {baseUrl: "http://x2", credentials: {}, toolSurface: fullSurface()}
  const tornDown: TenantHandle[] = []
  let calls = 0
  const driver = makeDriver({
    provision: async () => (calls++ === 0 ? h1 : h2),
    checkReadiness: async (h) => {
      if (h === h1) throw new Error("boom")
    },
    teardown: async (h) => {
      tornDown.push(h)
    },
  })
  const {handle, funnelToolsPresent} = await provisionWithRetry(driver, SCENARIO, "r", "")
  assert.equal(handle, h2)
  assert.equal(funnelToolsPresent, true)
  assert.deepEqual(tornDown, [h1])
})

test("provisionWithRetry throws after 3 failed attempts, tearing down each handle", async () => {
  const h: TenantHandle = {baseUrl: "http://x", credentials: {}, toolSurface: []}
  const tornDown: TenantHandle[] = []
  const driver = makeDriver({
    provision: async () => h,
    checkReadiness: async () => {
      throw new Error("boom")
    },
    teardown: async (hh) => {
      tornDown.push(hh)
    },
  })
  await assert.rejects(provisionWithRetry(driver, SCENARIO, "r", ""), /boom/)
  assert.equal(tornDown.length, 3)
})

test("provisionWithRetry throws ReadinessError when a readiness tool is missing from the declared surface", async () => {
  const handle: TenantHandle = {baseUrl: "http://x", credentials: {}, toolSurface: SCENARIO.readinessTools.slice(0, 4)}
  const driver = makeDriver({
    provision: async () => handle,
    checkReadiness: async () => {},
    teardown: async () => {},
  })
  await assert.rejects(
    provisionWithRetry(driver, SCENARIO, "r", ""),
    (err: unknown) => err instanceof ReadinessError && err.message.includes("missing readiness tools: c1_connector_authoring_get_test_run_evidence"),
  )
})

test("funnel_tools_present is false when the declared surface lacks funnel tools", async () => {
  const handle: TenantHandle = {baseUrl: "http://x", credentials: {}, toolSurface: SCENARIO.readinessTools}
  const driver = makeDriver({
    provision: async () => handle,
    checkReadiness: async () => {},
    teardown: async () => {},
  })
  const {funnelToolsPresent} = await provisionWithRetry(driver, SCENARIO, "r", "")
  assert.equal(funnelToolsPresent, false)
})

test("collectScoreInput returns the normalized score-input on success", async () => {
  const dir = mkdtempSync(join(tmpdir(), "collect-"))
  try {
    const channel = makeChannel(dir)
    const canned = readFileSync("evals/runner/drivers/tier0/score-input.json", "utf8")
    const driver: AgentDriver = {
      runAgent: async (req) => {
        writeFileSync(req.channel.scoreInputPath, canned)
        return {transcript: emptyStream(), timedOut: false, wallTimeMs: 0}
      },
    }
    const {scoreInput} = await collectScoreInput(driver, SCENARIO, "r", channel, join(dir, "handoff-sanitized.json"), {}, SCENARIO.readinessTools, false, "", 1)
    assert.equal(scoreInput.evidence.result, "PASS")
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("collectScoreInput retries once on a transient failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "collect-"))
  try {
    const channel = makeChannel(dir)
    const canned = readFileSync("evals/runner/drivers/tier0/score-input.json", "utf8")
    let calls = 0
    const driver: AgentDriver = {
      runAgent: async (req) => {
        calls++
        if (calls === 1) throw new Error("transient")
        writeFileSync(req.channel.scoreInputPath, canned)
        return {transcript: emptyStream(), timedOut: false, wallTimeMs: 0}
      },
    }
    const {scoreInput} = await collectScoreInput(driver, SCENARIO, "r", channel, join(dir, "handoff-sanitized.json"), {}, SCENARIO.readinessTools, false, "", 1)
    assert.equal(calls, 2)
    assert.equal(scoreInput.evidence.result, "PASS")
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("collectScoreInput rethrows after 2 failures when the handoff is complete", async () => {
  const dir = mkdtempSync(join(tmpdir(), "collect-"))
  try {
    const channel = makeChannel(dir)
    const driver: AgentDriver = {
      runAgent: async () => {
        throw new Error("collector down")
      },
    }
    const fullHandoff: Handoff = {
      catalog_id: "c",
      draft_id: "d",
      upload_id: "u",
      run_id: "r",
      revision_id: "rv",
      app_id: "a",
      connector_id: "cn",
      test_run_id: "t",
      deployment_instance_id: "di",
      activation_url: "https://x",
    }
    await assert.rejects(collectScoreInput(driver, SCENARIO, "r", channel, join(dir, "handoff-sanitized.json"), fullHandoff, SCENARIO.readinessTools, true, "", 1), /collector down/)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("collectScoreInput rethrows after 2 failures on a partial handoff", async () => {
  const dir = mkdtempSync(join(tmpdir(), "collect-"))
  try {
    const channel = makeChannel(dir)
    const driver: AgentDriver = {
      runAgent: async () => {
        throw new Error("collector down")
      },
    }
    const partialHandoff: Handoff = {
      catalog_id: "c",
      draft_id: "",
      upload_id: "",
      run_id: "",
      revision_id: "",
      app_id: "",
      connector_id: "",
      test_run_id: "",
      deployment_instance_id: "",
      activation_url: "",
    }
    await assert.rejects(collectScoreInput(driver, SCENARIO, "r", channel, join(dir, "handoff-sanitized.json"), partialHandoff, SCENARIO.readinessTools, false, "", 1), /collector down/)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("collectScoreInput returns a null score-input on the stalled path (absent handoff + collector failure)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "collect-"))
  try {
    const channel = makeChannel(dir)
    const driver: AgentDriver = {
      runAgent: async () => {
        throw new Error("collector down")
      },
    }
    const {scoreInput} = await collectScoreInput(driver, SCENARIO, "r", channel, join(dir, "handoff-sanitized.json"), {}, SCENARIO.readinessTools, false, "", 1)
    assert.deepEqual(scoreInput.draft.required_source_files, {})
    assert.equal(scoreInput.tenant_counts.users, null)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("isCollectionFailure is true only for an empty transcript with the driver-reported signal", () => {
  const empty = emptyStream()
  const withCalls = {...emptyStream(), toolCalls: [{name: "x", args: {}, result: null, error: null, stage: "S0"}]}
  assert.equal(isCollectionFailure({transcript: empty, timedOut: false, wallTimeMs: 0, collectionFailed: true}), true)
  // A genuine zero-tool-call stall (no signal) stays a scored outcome.
  assert.equal(isCollectionFailure({transcript: empty, timedOut: false, wallTimeMs: 0}), false)
  // A timed-out run always scores its partial stream.
  assert.equal(isCollectionFailure({transcript: empty, timedOut: true, wallTimeMs: 0, collectionFailed: true}), false)
  // A non-empty transcript is scored even with the signal (partial collection).
  assert.equal(isCollectionFailure({transcript: withCalls, timedOut: false, wallTimeMs: 0, collectionFailed: true}), false)
})

test("a valid --ref is accepted and the run completes (driver-interpreted)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "run-ref-"))
  try {
    const {code, stdout} = await runCli(["--scenario", "evals/scenarios/tier1-directory.json", "--driver", "tier0", "--ref", "main", "--out", dir], 120_000)
    assert.equal(code, 0)
    assert.ok(stdout.includes("record:"))
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("readHandoff treats a malformed handoff as a stall without surfacing the parse error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-"))
  try {
    const path = join(dir, "handoff.json")
    // Malformed JSON whose content carries a secret-like value — the parse
    // error must never reach stderr (JSON.parse messages embed a snippet).
    writeFileSync(path, '{"catalog_id": "cat-1", "activation_url": "https://secret-token.example/abc123",')
    const handoff = await readHandoff(path)
    assert.equal(handoff, null)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("collectScoreInput redacts a malformed score-input parse error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "collect-"))
  try {
    const channel = makeChannel(dir)
    const driver: AgentDriver = {
      runAgent: async (req) => {
        writeFileSync(req.channel.scoreInputPath, '{"connector_config": {"api-token": "super-secret-value",')
        return {transcript: emptyStream(), timedOut: false, wallTimeMs: 0}
      },
    }
    const fullHandoff: Handoff = {
      catalog_id: "c",
      draft_id: "d",
      upload_id: "u",
      run_id: "r",
      revision_id: "rv",
      app_id: "a",
      connector_id: "cn",
      test_run_id: "t",
      deployment_instance_id: "di",
      activation_url: "https://x",
    }
    await assert.rejects(
      collectScoreInput(driver, SCENARIO, "r", channel, join(dir, "handoff-sanitized.json"), fullHandoff, SCENARIO.readinessTools, true, "", 1),
      (err: unknown) => err instanceof Error && err.message.includes("unreadable score-input") && !err.message.includes("super-secret-value"),
    )
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})
