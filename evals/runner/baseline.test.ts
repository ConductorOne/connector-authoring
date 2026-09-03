// baseline.test.ts — unit smoke for the baseline generator (locked D17).
// Hand-built fixture JSONL records in a tmp dir, invoked via the CLI
// (execFile pattern from run.test.ts).
import {test} from "node:test"
import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {promisify} from "node:util"
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"

const execFileAsync = promisify(execFile)
const BASELINE = "evals/runner/baseline.ts"
const STAGES = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11"]
const MODEL = "together/deepseek-ai/DeepSeek-V4-Flash-0731"

function metaLine(
  runId: string,
  mode: string,
  model: string = MODEL,
  effort: string = "high",
): string {
  return JSON.stringify({
    run_id: runId,
    scenario: mode === "guide-only" ? "tier1-directory-guide-only" : "tier1-directory",
    skill_bundle_version: "0.0.0",
    skill_bundle_mode: mode,
    model_version: model,
    harness: "inherit",
    reasoning_effort: effort,
    started_at: "2026-09-02T12:00:00.000Z",
    wall_time_ms: 123456,
    funnel_tools_present: true,
  })
}

function stageRow(stage: string, pass: boolean, firstPass: boolean): string {
  return JSON.stringify({stage, gate: stage, pass, first_pass: firstPass, attempts: 1, evidence: "ok"})
}

function skippedRow(stage: string): string {
  return JSON.stringify({stage, gate: stage, pass: "skipped_human_boundary"})
}

function summaryLine(firstPassRate: number): string {
  return JSON.stringify({
    summary: true,
    funnel: STAGES,
    first_pass_rate: firstPassRate,
    recovery_cycles: 0,
    parity_verdict: "PASS",
    parity_evidence: "ok",
    parity_tenant: "not_applicable",
    parity_tenant_evidence: "ok",
    hygiene_verdict: "PASS",
    hygiene_evidence: "ok",
    handoff_discipline_verdict: true,
    tool_calls: 42,
    turns: 8,
    tokens_in: null,
    tokens_out: null,
  })
}

// Full 16-line record: meta + 12 stage rows + 2 skipped rows + summary.
function buildRecord(
  runId: string,
  mode: string,
  passFlags: boolean[],
  firstPassFlags: boolean[],
  firstPassRate: number,
  model: string = MODEL,
  effort: string = "high",
): string {
  const lines = [metaLine(runId, mode, model, effort)]
  for (let i = 0; i < 12; i++) {
    lines.push(stageRow(`S${i}`, passFlags[i], firstPassFlags[i]))
  }
  lines.push(skippedRow("S11b"))
  lines.push(skippedRow("S11c"))
  lines.push(summaryLine(firstPassRate))
  return lines.join("\n") + "\n"
}

function allPassRecord(runId: string, mode: string, model: string = MODEL, effort: string = "high"): string {
  return buildRecord(runId, mode, STAGES.map(() => true), STAGES.map(() => true), 1.0, model, effort)
}

async function runBaseline(outDir: string): Promise<{code: number; stdout: string; stderr: string}> {
  try {
    const {stdout, stderr} = await execFileAsync("node", ["--experimental-strip-types", BASELINE, "--out", outDir], {
      cwd: process.cwd(),
      timeout: 30_000,
    })
    return {code: 0, stdout, stderr}
  } catch (err) {
    const e = err as {code?: number; stdout?: string; stderr?: string}
    return {code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? ""}
  }
}

function readBaseline(outDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(outDir, "baseline.json"), "utf8")) as Record<string, unknown>
}

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "evals-baseline-"))
}

test("(a) pass/fail mix yields correct pass_rate, per_stage.failures, pareto", async () => {
  const dir = tmpDir()
  try {
    writeFileSync(join(dir, "a.jsonl"), allPassRecord("evals-tier1-directory-20260902-120000-000", "none"))
    const failFlags = STAGES.map((s) => s !== "S3")
    writeFileSync(join(dir, "b.jsonl"), buildRecord("evals-tier1-directory-20260902-120000-001", "none", failFlags, failFlags, 0.9))
    const {code, stdout} = await runBaseline(dir)
    assert.equal(code, 0)
    assert.ok(stdout.includes("baseline:"))
    const b = readBaseline(dir)
    const none = b.modes as Record<string, Record<string, unknown>>
    assert.equal(none.none.runs, 2)
    assert.equal(none.none.passes, 1)
    assert.equal(none.none.pass_rate, 0.5)
    const perStage = none.none.per_stage as Record<string, Record<string, unknown>>
    assert.equal(perStage.S3.failures, 1)
    assert.equal(perStage.S0.failures, 0)
    const pareto = b.pareto as {stage: string; failures: number; share: number}[]
    assert.deepEqual(pareto, [{stage: "S3", failures: 1, share: 1}])
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(b) skipped rows are excluded from the pass computation", async () => {
  const dir = tmpDir()
  try {
    writeFileSync(join(dir, "a.jsonl"), allPassRecord("evals-tier1-directory-20260902-120000-000", "none"))
    const {code} = await runBaseline(dir)
    assert.equal(code, 0)
    const b = readBaseline(dir)
    const none = b.modes as Record<string, Record<string, unknown>>
    assert.equal(none.none.passes, 1)
    assert.equal(none.none.pass_rate, 1)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(c) all-pass records yield an empty pareto", async () => {
  const dir = tmpDir()
  try {
    writeFileSync(join(dir, "a.jsonl"), allPassRecord("evals-tier1-directory-20260902-120000-000", "none"))
    writeFileSync(join(dir, "b.jsonl"), allPassRecord("evals-tier1-directory-20260902-120000-001", "none"))
    const {code} = await runBaseline(dir)
    assert.equal(code, 0)
    const b = readBaseline(dir)
    assert.deepEqual(b.pareto, [])
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(d) multi-mode grouping: modes keys and run_ids sorted", async () => {
  const dir = tmpDir()
  try {
    writeFileSync(join(dir, "a.jsonl"), allPassRecord("evals-tier1-directory-20260902-120000-001", "none"))
    writeFileSync(join(dir, "b.jsonl"), allPassRecord("evals-tier1-directory-guide-only-20260902-120000-000", "guide-only"))
    writeFileSync(join(dir, "c.jsonl"), allPassRecord("evals-tier1-directory-20260902-120000-000", "none"))
    const {code} = await runBaseline(dir)
    assert.equal(code, 0)
    const b = readBaseline(dir)
    const modes = b.modes as Record<string, Record<string, unknown>>
    assert.deepEqual(Object.keys(modes), ["guide-only", "none"])
    assert.deepEqual(modes.none.run_ids, [
      "evals-tier1-directory-20260902-120000-000",
      "evals-tier1-directory-20260902-120000-001",
    ])
    assert.deepEqual(modes["guide-only"].run_ids, ["evals-tier1-directory-guide-only-20260902-120000-000"])
    assert.deepEqual(b.scenarios, ["tier1-directory", "tier1-directory-guide-only"])
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(e) mismatched model_version across records exits 1", async () => {
  const dir = tmpDir()
  try {
    writeFileSync(join(dir, "a.jsonl"), allPassRecord("evals-tier1-directory-20260902-120000-000", "none"))
    writeFileSync(join(dir, "b.jsonl"), allPassRecord("evals-tier1-directory-20260902-120000-001", "none", "together/other/model"))
    const {code, stderr} = await runBaseline(dir)
    assert.equal(code, 1)
    assert.ok(stderr.includes("model_version"))
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(f) malformed record (no summary line) exits 1", async () => {
  const dir = tmpDir()
  try {
    const lines = allPassRecord("evals-tier1-directory-20260902-120000-000", "none").trim().split("\n")
    writeFileSync(join(dir, "a.jsonl"), lines.slice(0, -1).join("\n") + "\n")
    const {code, stderr} = await runBaseline(dir)
    assert.equal(code, 1)
    assert.ok(stderr.includes("a.jsonl"))
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(g) first_pass_rate_mean and per_stage.first_pass_failures computed correctly", async () => {
  const dir = tmpDir()
  try {
    // One record: S5 has first_pass: false but pass: true (recovered).
    const passFlags = STAGES.map(() => true)
    const firstPassFlags = STAGES.map((s) => s !== "S5")
    writeFileSync(join(dir, "a.jsonl"), buildRecord("evals-tier1-directory-20260902-120000-000", "none", passFlags, firstPassFlags, 0.75))
    const {code} = await runBaseline(dir)
    assert.equal(code, 0)
    const b = readBaseline(dir)
    const none = b.modes as Record<string, Record<string, unknown>>
    assert.equal(none.none.first_pass_rate_mean, 0.75)
    const perStage = none.none.per_stage as Record<string, Record<string, unknown>>
    assert.equal(perStage.S5.first_pass_failures, 1)
    assert.equal(perStage.S5.failures, 0)
    assert.equal(perStage.S0.first_pass_failures, 0)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(h) mismatched reasoning_effort across records exits 1", async () => {
  const dir = tmpDir()
  try {
    writeFileSync(join(dir, "a.jsonl"), allPassRecord("evals-tier1-directory-20260902-120000-000", "none"))
    writeFileSync(join(dir, "b.jsonl"), allPassRecord("evals-tier1-directory-20260902-120000-001", "none", MODEL, "low"))
    const {code, stderr} = await runBaseline(dir)
    assert.equal(code, 1)
    assert.ok(stderr.includes("reasoning_effort"))
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(i) unknown skill_bundle_mode exits 1", async () => {
  const dir = tmpDir()
  try {
    writeFileSync(join(dir, "a.jsonl"), allPassRecord("evals-tier1-directory-20260902-120000-000", "bogus-mode"))
    const {code, stderr} = await runBaseline(dir)
    assert.equal(code, 1)
    assert.ok(stderr.includes("skill_bundle_mode"))
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(i2) a non-matrix mode record is skipped, not fatal", async () => {
  const dir = tmpDir()
  try {
    writeFileSync(join(dir, "a.jsonl"), allPassRecord("evals-tier1-directory-20260902-120000-000", "none"))
    writeFileSync(join(dir, "b.jsonl"), allPassRecord("evals-tier1-directory-full-20260902-120000-000", "full"))
    const {code, stderr} = await runBaseline(dir)
    assert.equal(code, 0)
    assert.ok(stderr.includes("skipping b.jsonl"))
    assert.ok(stderr.includes("full"))
    const b = readBaseline(dir)
    const modes = b.modes as Record<string, Record<string, unknown>>
    assert.deepEqual(Object.keys(modes), ["none"])
    assert.equal(modes.none.runs, 1)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(i3) pass_at_3 is null when a mode has fewer than 3 runs", async () => {
  const dir = tmpDir()
  try {
    writeFileSync(join(dir, "a.jsonl"), allPassRecord("evals-tier1-directory-20260902-120000-000", "none"))
    const {code} = await runBaseline(dir)
    assert.equal(code, 0)
    const b = readBaseline(dir)
    const none = b.modes as Record<string, Record<string, unknown>>
    assert.equal(none.none.pass_at_3, null)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(j) duplicate stage row exits 1", async () => {
  const dir = tmpDir()
  try {
    const lines = [metaLine("evals-tier1-directory-20260902-120000-000", "none")]
    for (let i = 0; i < 12; i++) {
      lines.push(stageRow(`S${i}`, true, true))
    }
    lines.push(stageRow("S0", true, true)) // duplicate S0
    lines.push(skippedRow("S11b"))
    lines.push(skippedRow("S11c"))
    lines.push(summaryLine(1.0))
    writeFileSync(join(dir, "a.jsonl"), lines.join("\n") + "\n")
    const {code, stderr} = await runBaseline(dir)
    assert.equal(code, 1)
    assert.ok(stderr.includes("duplicate stage row S0"))
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})
