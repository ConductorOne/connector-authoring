// run.test.ts — CLI contract smoke for the runner (locked E1/L18).
// The exit-code contract and the --ref injection guard are security-relevant
// and must not regress: --help exits 0, missing required args exit 1, an
// invalid --ref exits 1 with a clear error.
import {test} from "node:test"
import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {promisify} from "node:util"
import {buildRunMeta} from "./record.ts"
import type {Scenario} from "./scenario.ts"

const execFileAsync = promisify(execFile)
const RUN = "evals/runner/run.ts"

async function runCli(args: string[]): Promise<{code: number; stdout: string; stderr: string}> {
  try {
    const {stdout, stderr} = await execFileAsync("node", ["--experimental-strip-types", RUN, ...args], {
      cwd: process.cwd(),
      timeout: 30_000,
    })
    return {code: 0, stdout, stderr}
  } catch (err) {
    const e = err as {code?: number; stdout?: string; stderr?: string}
    return {code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? ""}
  }
}

test("--help exits 0 with usage", async () => {
  const {code, stdout, stderr} = await runCli(["--help"])
  assert.equal(code, 0)
  assert.ok((stdout + stderr).includes("usage: node evals/runner/run.ts"))
})

test("missing --scenario/--ref exits 1", async () => {
  const {code} = await runCli([])
  assert.equal(code, 1)
})

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
  skillBundle: {mode: "guide-only", version: "0.0.0"},
  model: "together/deepseek-ai/DeepSeek-V4-Flash-0731",
  reasoningEffort: "high",
  requiredSourceFiles: ["connector.ts", "config-schema.json", "runtime-schema.json", "capabilities.json"],
  readinessTools: ["c1_connector_authoring_get_authoring_guide"],
  handoffPath: "/current-tasks/evals/<run-id>/handoff.json",
}

test("buildRunMeta carries the scenario reasoning-effort pin and skill-bundle mode", () => {
  const meta = buildRunMeta("r", SCENARIO, "inherit", "2026-09-03T00:00:00.000Z", 123456, true)
  assert.equal(meta.reasoning_effort, "high")
  assert.equal(meta.skill_bundle_mode, "guide-only")
  assert.equal(meta.skill_bundle_version, "0.0.0")
  assert.equal(meta.model_version, SCENARIO.model)
  assert.equal(meta.harness, "inherit")
  assert.equal(meta.run_id, "r")
  assert.equal(meta.scenario, "tier1-directory")
  assert.equal(meta.funnel_tools_present, true)
})

test("an invalid --ref (shell metacharacters) exits 1 with a clear error", async () => {
  const {code, stderr} = await runCli(["--scenario", "evals/scenarios/tier1-directory.json", "--ref", "bad;rm -rf /"])
  assert.equal(code, 1)
  assert.ok(stderr.includes("invalid --ref"))
})
