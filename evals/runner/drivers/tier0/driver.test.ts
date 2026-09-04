// drivers/tier0/driver.test.ts — Tier-0 driver tests.
import {test} from "node:test"
import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {promisify} from "node:util"
import {mkdtempSync, readFileSync, readdirSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {tier0, TIER0_TOOL_SURFACE} from "./driver.ts"
import {scoreRun} from "../../score.ts"
import {writeRecord, type RunMeta, type SummaryLine} from "../../record.ts"
import {SKIPPED_STAGES, type Pre1Artifact, type ScoreInput, type StageCtx} from "../../stages.ts"
import {FUNNEL_TOOLS, type RunChannel} from "../../driver.ts"
import type {Scenario} from "../../scenario.ts"

const execFileAsync = promisify(execFile)

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
  reasoningEffort: "high",
  requiredSourceFiles: ["connector.ts", "config-schema.json", "runtime-schema.json", "capabilities.json"],
  readinessTools: [
    "c1_connector_authoring_get_authoring_guide",
    "c1_connector_authoring_create_draft",
    "c1_connector_authoring_build_bundle",
    "c1_connector_authoring_run_draft_test_sync",
    "c1_connector_authoring_get_test_run_evidence",
  ],
}

test("tier0 provisioner readiness passes against the live local fixture", async () => {
  const handle = await tier0.provisioner.provision({scenario: SCENARIO, runId: "tier0-test", ref: ""})
  try {
    await tier0.provisioner.checkReadiness(handle)
    assert.ok(handle.toolSurface.length >= 16)
    assert.ok((SCENARIO.readinessTools ?? []).every((t) => handle.toolSurface.includes(t)))
    // The declared surface carries the full funnel, so the runner's
    // funnel_tools_present derivation (FUNNEL_TOOLS ⊆ toolSurface) is true.
    assert.ok(FUNNEL_TOOLS.every((t) => handle.toolSurface.includes(t)))
  } finally {
    await tier0.provisioner.teardown(handle)
  }
})

test("tier0 agent driver replays a canned run that scores a schema-valid 16-line record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tier0-"))
  try {
    const channel: RunChannel = {
      runDir: dir,
      handoffPath: join(dir, "handoff.json"),
      scoreInputPath: join(dir, "score-input.json"),
      transcriptPath: join(dir, "transcript.json"),
      pre1Path: join(dir, "pre1.json"),
      handoffInstructions: "",
      completionInstructions: "",
      pre1Instructions: "",
    }
    const result = await tier0.agentDriver.runAgent({kind: "agent", prompt: "p", toolSurface: TIER0_TOOL_SURFACE, channel, timeoutMs: 60_000, model: "m", ref: ""})
    assert.equal(result.timedOut, false)
    assert.equal(result.transcript.stageAttempts["S0"], 1)
    assert.equal(result.transcript.stageAttempts["S11"], 1)
    const handoff = JSON.parse(readFileSync(channel.handoffPath, "utf8")) as Record<string, unknown>
    assert.equal(Object.keys(handoff).length, 10)
    // The collector leg writes score-input.json into the run channel.
    await tier0.agentDriver.runAgent({kind: "collector", prompt: "p", toolSurface: TIER0_TOOL_SURFACE, channel, timeoutMs: 60_000, model: "m", ref: ""})
    const scoreInput = JSON.parse(readFileSync(channel.scoreInputPath, "utf8")) as ScoreInput
    const ctx: StageCtx = {transcript: result.transcript, handoff, scoreInput, handoffPath: channel.handoffPath}
    const scored = scoreRun(ctx)
    assert.ok(scored.stageRows.every((r) => r.pass))
    // The canned artifacts must produce the full compliant funnel — parity
    // and hygiene verdicts are part of the intent (decision 8), not just the
    // stage rows.
    assert.equal(scored.parity_verdict, "PASS")
    assert.equal(scored.hygiene_verdict, "PASS")
    const meta: RunMeta = {
      run_id: "tier0-test",
      scenario: "tier1-directory",
      skill_bundle_version: "0.0.0",
      skill_bundle_mode: "none",
      model_version: "m",
      harness: "tier0",
      reasoning_effort: "n/a",
      started_at: new Date().toISOString(),
      wall_time_ms: result.wallTimeMs,
      funnel_tools_present: true,
    }
    const summary: SummaryLine = {
      summary: true,
      funnel: scored.funnel,
      first_pass_rate: scored.first_pass_rate,
      recovery_cycles: scored.recovery_cycles,
      parity_verdict: scored.parity_verdict,
      parity_evidence: scored.parity_evidence,
      parity_tenant: scored.parity_tenant,
      parity_tenant_evidence: scored.parity_tenant_evidence,
      hygiene_verdict: scored.hygiene_verdict,
      hygiene_evidence: scored.hygiene_evidence,
      handoff_discipline_verdict: scored.handoff_discipline_verdict,
      tool_calls: result.transcript.toolCalls.length,
      turns: result.transcript.turns,
      tokens_in: result.transcript.tokensIn,
      tokens_out: result.transcript.tokensOut,
    }
    const path = writeRecord("tier0-test", SCENARIO, meta, scored.stageRows, SKIPPED_STAGES, summary, dir)
    const lines = readFileSync(path, "utf8").trim().split("\n")
    assert.equal(lines.length, 16)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("the CLI resolves --driver tier0 end-to-end (registry resolution)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tier0-cli-"))
  try {
    const {stdout, stderr} = await execFileAsync(
      "node",
      ["--experimental-strip-types", "evals/runner/run.ts", "--scenario", "evals/scenarios/tier1-directory.json", "--driver", "tier0", "--out", dir],
      {cwd: process.cwd(), timeout: 120_000},
    )
    assert.ok(stdout.includes("record:"), `expected a record line, got stdout=${stdout} stderr=${stderr}`)
    const jsonls = readdirSync(dir).filter((f) => f.endsWith(".jsonl"))
    assert.equal(jsonls.length, 1)
    const lines = readFileSync(join(dir, jsonls[0]), "utf8").trim().split("\n")
    assert.equal(lines.length, 16)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("canned artifacts are grep-clean", () => {
  // Tokens are assembled from fragments so the test source itself stays
  // clean under the provenance grep (which must match nothing in evals/).
  const forbidden = [
    "squ" + "ire",
    "c1" + "dev",
    "create_" + "env",
    "/sha" + "red/",
    "/current-" + "tasks/",
    "ar" + "ena",
    "be" + "ad",
    "CXF" + "-",
  ]
  // Walk the tier0 dir including the canned-* subdirectories.
  const names = ["transcript.json", "handoff.json", "score-input.json", "pre1.json"]
  const walk = (dir: string): string[] => {
    const out: string[] = []
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...walk(p))
      else if (names.includes(entry.name)) out.push(p)
    }
    return out
  }
  const files = walk(import.meta.dirname)
  assert.ok(files.length >= 6, `expected the fixed set + two canned sets, got ${files.join(", ")}`)
  for (const file of files) {
    const content = readFileSync(file, "utf8")
    for (const token of forbidden) {
      assert.ok(!content.includes(token), `${file} contains forbidden token ${token}`)
    }
  }
})

// --- pre-1 replays ---

import {loadScenario} from "../../scenario.ts"
import type {ScoreResult} from "../../score.ts"

function pre1Channel(dir: string): RunChannel {
  return {
    runDir: dir,
    handoffPath: join(dir, "handoff.json"),
    scoreInputPath: join(dir, "score-input.json"),
    transcriptPath: join(dir, "transcript.json"),
    pre1Path: join(dir, "pre1.json"),
    handoffInstructions: "",
    completionInstructions: "",
    pre1Instructions: "",
  }
}

async function replayPre1(scenarioPath: string, scenarioId: string): Promise<{scored: ScoreResult; pre1: Pre1Artifact}> {
  const dir = mkdtempSync(join(tmpdir(), "tier0-pre1-"))
  try {
    const channel = pre1Channel(dir)
    const result = await tier0.agentDriver.runAgent({
      kind: "agent",
      prompt: "p",
      toolSurface: TIER0_TOOL_SURFACE,
      channel,
      timeoutMs: 60_000,
      model: "m",
      ref: "",
      scenarioId,
    })
    assert.equal(result.timedOut, false)
    const pre1 = JSON.parse(readFileSync(channel.pre1Path, "utf8")) as Pre1Artifact
    const scenario = loadScenario(scenarioPath)
    const ctx: StageCtx = {
      transcript: result.transcript,
      handoff: {},
      scoreInput: {
        run_id: "pre1-canned",
        draft: {required_source_files: {}, source_files: [], config_schema: {fields: []}, runtime_schema: {fields: []}},
        connector_config: {},
        evidence: {},
        build_run: {},
        tenant_counts: {users: null, groups: null, memberships: null},
        resource_ids: {users: [], groups: []},
      },
      handoffPath: channel.pre1Path,
      kind: "pre1",
      pre1,
      expected: {decision: scenario.expectedDecision!, accessModel: scenario.expectedAccessModel, parkEvidence: scenario.expectedParkEvidence},
    }
    return {scored: scoreRun(ctx), pre1}
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
}

test("a pre1-directory-proceed replay writes pre1.json and scores P0-P3 pass", async () => {
  const {scored} = await replayPre1("evals/scenarios/pre1-directory-proceed.json", "pre1-directory-proceed")
  assert.equal(scored.decision_verdict, "proceed")
  assert.deepEqual(scored.stageRows.map((r) => r.stage), ["P0", "P1", "P2", "P3"])
  assert.ok(scored.stageRows.every((r) => r.pass))
})

test("a pre1-noiam-park replay writes pre1.json and scores P0/P1/P4 pass", async () => {
  const {scored} = await replayPre1("evals/scenarios/pre1-noiam-park.json", "pre1-noiam-park")
  assert.equal(scored.decision_verdict, "park")
  assert.deepEqual(scored.stageRows.map((r) => r.stage), ["P0", "P1", "P4"])
  assert.ok(scored.stageRows.every((r) => r.pass))
})
