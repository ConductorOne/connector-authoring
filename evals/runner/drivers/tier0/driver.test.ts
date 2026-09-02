// drivers/tier0/driver.test.ts — Tier-0 driver tests.
import {test} from "node:test"
import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {promisify} from "node:util"
import {mkdtempSync, readFileSync, readdirSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {tier0, TIER0_TOOL_SURFACE} from "./driver.ts"
import type {RunChannel} from "../../driver.ts"
import {normalizeScoreInput} from "../../collect.ts"
import {scoreRun} from "../../score.ts"
import type {Handoff} from "../../stages.ts"
import type {Scenario} from "../../scenario.ts"

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

// Tokens are split so the test file itself stays grep-clean (decision 7).
const FORBIDDEN = ["squi" + "re", "c1" + "dev", "create" + "_env", "/shared" + "/", "/current" + "-tasks/", "are" + "na", "be" + "ad", "CXF" + "-"]

test("tier0 provisioner readiness passes against the live local fixture", async () => {
  const handle = await tier0.provisioner.provision({scenario: SCENARIO, runId: "tier0-test"})
  try {
    const ready = await tier0.provisioner.checkReadiness(handle)
    assert.equal(ready.funnelToolsPresent, true)
    assert.ok(handle.toolSurface.length >= 16)
    assert.ok(SCENARIO.readinessTools.every((t) => handle.toolSurface.includes(t)))
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
      handoffInstructions: "",
      completionInstructions: "",
    }
    const result = await tier0.agentDriver.runAgent({kind: "agent", prompt: "p", toolSurface: TIER0_TOOL_SURFACE, channel, timeoutMs: 60_000, model: "m"})
    assert.equal(result.timedOut, false)
    assert.equal(result.transcript.stageAttempts["S0"], 1)
    assert.equal(result.transcript.stageAttempts["S11"], 1)
    // The canned handoff is a known 10-field shape (test fixture).
    const handoff = JSON.parse(readFileSync(channel.handoffPath, "utf8")) as Handoff
    assert.equal(Object.keys(handoff).length, 10)
    // The collector leg writes the canned score-input; the full run scores
    // a clean funnel (first_pass_rate 1.0, handoff discipline held).
    await tier0.agentDriver.runAgent({kind: "collector", prompt: "p", toolSurface: TIER0_TOOL_SURFACE, channel, timeoutMs: 60_000, model: "m"})
    const normalized = normalizeScoreInput(JSON.parse(readFileSync(channel.scoreInputPath, "utf8")))
    const scored = scoreRun({transcript: result.transcript, handoff, scoreInput: normalized.scoreInput, handoffPath: channel.handoffPath})
    assert.equal(scored.first_pass_rate, 1.0)
    assert.equal(scored.handoff_discipline_verdict, true)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("the CLI resolves --driver tier0 end-to-end (registry resolution)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tier0-cli-"))
  try {
    const execFileAsync = promisify(execFile)
    const {stdout} = await execFileAsync("node", ["--experimental-strip-types", "evals/runner/run.ts", "--scenario", "evals/scenarios/tier1-directory.json", "--driver", "tier0", "--out", dir], {cwd: process.cwd(), timeout: 120_000})
    assert.ok(stdout.includes("record:"))
    const records = readdirSync(dir).filter((f) => f.endsWith(".jsonl"))
    assert.equal(records.length, 1)
    const lines = readFileSync(join(dir, records[0]), "utf8").trim().split("\n")
    assert.equal(lines.length, 16)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("canned artifacts are grep-clean", () => {
  for (const name of ["transcript.json", "handoff.json", "score-input.json"]) {
    const content = readFileSync(join("evals/runner/drivers/tier0", name), "utf8")
    for (const token of FORBIDDEN) {
      assert.ok(!content.includes(token), `${name} contains forbidden token ${token}`)
    }
  }
})
