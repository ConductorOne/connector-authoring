// scenario.test.ts — unit smoke for the scenario loader (locked B2).
// Loads the REAL tier1-directory.json and asserts the locked contract.
import {test} from "node:test"
import assert from "node:assert/strict"
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {loadScenario} from "./scenario.ts"

test("loadScenario loads the real tier1-directory.json", () => {
  const s = loadScenario("evals/scenarios/tier1-directory.json")
  assert.equal(s.id, "tier1-directory")
  assert.equal(s.fixture.auth, "basic")
  assert.equal(s.fixture.basicAuth.username, "connector@example.com")
  assert.equal(s.fixture.basicAuth.password, "fixture-token")
  assert.equal(s.fixture.bearerToken, "fixture-token")
  assert.equal(s.seed!.users, 23)
  assert.equal(s.seed!.groups, 5)
  assert.equal(s.seed!.memberships, 23)
  assert.equal(s.seed!.nullTitleUsers, 3)
  assert.equal(s.seed!.unscopedSubset, 3)
  assert.equal(s.seed!.disabledUsers, 2)
  assert.equal(s.expected!.users, 23)
  assert.equal(s.expected!.groups, 5)
  assert.equal(s.expected!.memberships, 23)
  assert.equal(s.skillBundle.mode, "none")
  assert.equal(s.model, "together/deepseek-ai/DeepSeek-V4-Flash-0731")
  assert.equal(s.reasoningEffort, "high")
  assert.equal(s.requiredSourceFiles!.length, 4)
  assert.equal(s.readinessTools!.length, 5)
})

test("loadScenario loads the real tier1-directory-guide-only.json", () => {
  const s = loadScenario("evals/scenarios/tier1-directory-guide-only.json")
  assert.equal(s.id, "tier1-directory-guide-only")
  assert.equal(s.skillBundle.mode, "guide-only")
  assert.equal(s.reasoningEffort, "high")
  assert.equal(s.model, "together/deepseek-ai/DeepSeek-V4-Flash-0731")
})

test("loadScenario rejects an invalid reasoningEffort value", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-scenario-"))
  try {
    const bad = join(dir, "bad.json")
    writeFileSync(bad, JSON.stringify({...JSON.parse(readFileSync("evals/scenarios/tier1-directory.json", "utf8")), reasoningEffort: "ultra"}))
    assert.throws(() => loadScenario(bad), /reasoningEffort/)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("loadScenario rejects a missing reasoningEffort field", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-scenario-"))
  try {
    const bad = join(dir, "bad.json")
    const parsed = JSON.parse(readFileSync("evals/scenarios/tier1-directory.json", "utf8")) as Record<string, unknown>
    delete parsed.reasoningEffort
    writeFileSync(bad, JSON.stringify(parsed))
    assert.throws(() => loadScenario(bad), /reasoningEffort/)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("loadScenario rejects a missing required field", () => {
  assert.throws(() => loadScenario("/nonexistent.json"), /cannot read scenario file/)
})

test("loadScenario rejects an unsafe scenario id (path traversal)", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-scenario-"))
  try {
    const bad = join(dir, "bad.json")
    writeFileSync(bad, JSON.stringify({...JSON.parse(readFileSync("evals/scenarios/tier1-directory.json", "utf8")), id: "../../etc/passwd"}))
    assert.throws(() => loadScenario(bad), /scenario.id invalid/)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

// --- pre1 kind ---

function pre1Base(): Record<string, unknown> {
  return JSON.parse(readFileSync("evals/scenarios/pre1-directory-proceed.json", "utf8")) as Record<string, unknown>
}

function writePre1(dir: string, name: string, data: Record<string, unknown>): string {
  const p = join(dir, name)
  writeFileSync(p, JSON.stringify(data))
  return p
}

test("loadScenario loads the pre1-directory-proceed scenario (kind pre1, proceed)", () => {
  const s = loadScenario("evals/scenarios/pre1-directory-proceed.json")
  assert.equal(s.kind, "pre1")
  assert.equal(s.expectedDecision, "proceed")
  assert.ok(s.expectedAccessModel)
  const ids = s.expectedAccessModel.resource_types.map((rt) => rt.id)
  assert.ok(ids.includes("user"))
  assert.ok(ids.includes("group"))
  assert.equal(s.seed, undefined)
  assert.equal(s.requiredSourceFiles, undefined)
  assert.equal(s.skillBundle.mode, "full")
  assert.equal(s.skillBundle.version, "0.3.0")
})

test("loadScenario loads the pre1-noiam-park scenario (kind pre1, park)", () => {
  const s = loadScenario("evals/scenarios/pre1-noiam-park.json")
  assert.equal(s.kind, "pre1")
  assert.equal(s.expectedDecision, "park")
  assert.ok(s.expectedParkEvidence)
  assert.ok(s.expectedParkEvidence.missing_paths.length > 0)
  assert.equal(s.seed, undefined)
})

test("loadScenario rejects a pre1 scenario carrying a funnel-only seed", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-scenario-"))
  try {
    const bad = pre1Base()
    bad.seed = {users: 1, groups: 1, memberships: 1, nullTitleUsers: 0, unscopedSubset: 0, disabledUsers: 0}
    assert.throws(() => loadScenario(writePre1(dir, "bad.json", bad)), /funnel-only/)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("loadScenario rejects a pre1 scenario with BOTH expected halves", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-scenario-"))
  try {
    const bad = pre1Base()
    bad.expectedParkEvidence = {
      spec_version_checked: "1.0.0",
      missing_paths: ["/v1/users"],
      vendor_doc: "console only",
      revisit_trigger: "ships an API",
    }
    assert.throws(() => loadScenario(writePre1(dir, "bad.json", bad)), /exactly one/)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("loadScenario rejects a pre1 scenario with NEITHER expected half", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-scenario-"))
  try {
    const bad = pre1Base()
    delete bad.expectedAccessModel
    assert.throws(() => loadScenario(writePre1(dir, "bad.json", bad)), /exactly one/)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("loadScenario rejects an invalid pre1 expectedDecision", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-scenario-"))
  try {
    const bad = pre1Base()
    bad.expectedDecision = "maybe"
    assert.throws(() => loadScenario(writePre1(dir, "bad.json", bad)), /expectedDecision/)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("loadScenario rejects a pre1 scenario missing providerBrief", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-scenario-"))
  try {
    const bad = pre1Base()
    delete bad.providerBrief
    assert.throws(() => loadScenario(writePre1(dir, "bad.json", bad)), /providerBrief/)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("the existing funnel scenarios still load with kind funnel", () => {
  for (const p of ["evals/scenarios/tier1-directory.json", "evals/scenarios/tier1-directory-guide-only.json", "evals/scenarios/tier1-directory-full.json"]) {
    const s = loadScenario(p)
    assert.equal(s.kind, "funnel")
    assert.ok(s.seed)
    assert.ok(s.expected)
    assert.equal(s.requiredSourceFiles?.length, 4)
    assert.equal(s.readinessTools?.length, 5)
  }
})
