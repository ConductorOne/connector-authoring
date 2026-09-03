// baseline.test.ts — unit smoke for the baseline.json generator (locked D17).
// Hand-built fixture JSONL records in a tmp dir, invoked via the CLI
// (execFile pattern from run.test.ts). Covers the eight locked cases:
// pass/fail mix, skipped-row exclusion, all-pass empty pareto, multi-mode
// grouping, model/effort mismatch exits, malformed record exit, and
// first-pass-rate mean + per-stage first-pass failures.
import {test} from "node:test"
import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {promisify} from "node:util"
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"

const execFileAsync = promisify(execFile)
const BASELINE = "evals/runner/baseline.ts"

const STAGES = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11"]

interface RecordSpec {
  runId: string
  mode: string
  scenario?: string
  model?: string
  effort?: string
  passFlags: boolean[]
  firstPassFlags: boolean[]
  firstPassRate: number
}

// Build a full 16-line record: 1 meta + 12 stage rows + 2 skipped rows +
// 1 summary line (exact fixture shapes from D17).
function buildRecord(spec: RecordSpec): string {
  const meta = {
    run_id: spec.runId,
    scenario: spec.scenario ?? "tier1-directory",
    skill_bundle_version: "0.0.0",
    skill_bundle_mode: spec.mode,
    model_version: spec.model ?? "together/deepseek-ai/DeepSeek-V4-Flash-0731",
    harness: "omp",
    reasoning_effort: spec.effort ?? "high",
    started_at: "2026-09-02T12:00:00.000Z",
    wall_time_ms: 123456,
    funnel_tools_present: true,
  }
  const lines = [JSON.stringify(meta)]
  for (let i = 0; i < STAGES.length; i++) {
    lines.push(
      JSON.stringify({
        stage: STAGES[i],
        gate: STAGES[i],
        pass: spec.passFlags[i],
        first_pass: spec.firstPassFlags[i],
        attempts: 1,
        evidence: "ok",
      }),
    )
  }
  lines.push(JSON.stringify({stage: "S11b", gate: "REVISION_STATUS_ACTIVE", pass: "skipped_human_boundary"}))
  lines.push(JSON.stringify({stage: "S11c", gate: "SYNC_STATUS_DONE", pass: "skipped_human_boundary"}))
  lines.push(
    JSON.stringify({
      summary: true,
      funnel: STAGES.filter((_, i) => spec.passFlags[i]),
      first_pass_rate: spec.firstPassRate,
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
    }),
  )
  return lines.join("\n") + "\n"
}

async function runCli(outDir: string): Promise<{code: number; stdout: string; stderr: string}> {
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

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "evals-baseline-"))
}

function readBaseline(outDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(outDir, "baseline.json"), "utf8")) as Record<string, unknown>
}

test("pass/fail mix computes pass_rate, per_stage failures, and pareto", async () => {
  const dir = tmpDir()
  try {
    // One all-pass record, one record failing S3 and S7 (first_pass false on S3).
    const passFlags = STAGES.map(() => true)
    const failFlags = STAGES.map(() => true)
    failFlags[3] = false
    failFlags[7] = false
    writeFileSync(join(dir, "a.jsonl"), buildRecord({runId: "r-pass", mode: "none", passFlags, firstPassFlags: passFlags, firstPassRate: 1.0}))
    writeFileSync(join(dir, "b.jsonl"), buildRecord({runId: "r-fail", mode: "none", passFlags: failFlags, firstPassFlags: failFlags, firstPassRate: 0.5}))
    const {code, stdout} = await runCli(dir)
    assert.equal(code, 0)
    assert.ok(stdout.includes("baseline: "))
    const b = readBaseline(dir)
    const none = b.modes as Record<string, Record<string, unknown>>
    assert.equal(none.none.runs, 2)
    assert.equal(none.none.passes, 1)
    assert.equal(none.none.pass_rate, 0.5)
    assert.equal(none.none.pass_at_3, 1)
    const perStage = none.none.per_stage as Record<string, {failures: number}>
    assert.equal(perStage.S3.failures, 1)
    assert.equal(perStage.S7.failures, 1)
    assert.equal(perStage.S0.failures, 0)
    const pareto = b.pareto as {stage: string; failures: number; share: number}[]
    assert.equal(pareto.length, 2)
    assert.equal(pareto[0].stage, "S3")
    assert.equal(pareto[0].failures, 1)
    assert.equal(pareto[0].share, 0.5)
    assert.equal(pareto[1].stage, "S7")
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("skipped rows are excluded from pass computation", async () => {
  const dir = tmpDir()
  try {
    const passFlags = STAGES.map(() => true)
    writeFileSync(join(dir, "a.jsonl"), buildRecord({runId: "r-all-pass", mode: "none", passFlags, firstPassFlags: passFlags, firstPassRate: 1.0}))
    const {code} = await runCli(dir)
    assert.equal(code, 0)
    const b = readBaseline(dir)
    const none = b.modes as Record<string, Record<string, unknown>>
    assert.equal(none.none.passes, 1)
    assert.equal(none.none.pass_rate, 1)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("all-pass records produce an empty pareto", async () => {
  const dir = tmpDir()
  try {
    const passFlags = STAGES.map(() => true)
    writeFileSync(join(dir, "a.jsonl"), buildRecord({runId: "r1", mode: "none", passFlags, firstPassFlags: passFlags, firstPassRate: 1.0}))
    writeFileSync(join(dir, "b.jsonl"), buildRecord({runId: "r2", mode: "guide-only", passFlags, firstPassFlags: passFlags, firstPassRate: 1.0}))
    const {code} = await runCli(dir)
    assert.equal(code, 0)
    const b = readBaseline(dir)
    assert.deepEqual(b.pareto, [])
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("multi-mode grouping: modes keys sorted, run_ids per mode sorted", async () => {
  const dir = tmpDir()
  try {
    const passFlags = STAGES.map(() => true)
    writeFileSync(join(dir, "z.jsonl"), buildRecord({runId: "r-z", mode: "guide-only", passFlags, firstPassFlags: passFlags, firstPassRate: 1.0}))
    writeFileSync(join(dir, "a.jsonl"), buildRecord({runId: "r-a", mode: "none", passFlags, firstPassFlags: passFlags, firstPassRate: 1.0}))
    writeFileSync(join(dir, "m.jsonl"), buildRecord({runId: "r-m", mode: "none", passFlags, firstPassFlags: passFlags, firstPassRate: 1.0}))
    const {code} = await runCli(dir)
    assert.equal(code, 0)
    const b = readBaseline(dir)
    const modes = b.modes as Record<string, {run_ids: string[]}>
    assert.deepEqual(Object.keys(modes), ["guide-only", "none"])
    assert.deepEqual(modes.none.run_ids, ["r-a", "r-m"])
    assert.deepEqual(modes["guide-only"].run_ids, ["r-z"])
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("mismatched model_version across records exits 1", async () => {
  const dir = tmpDir()
  try {
    const passFlags = STAGES.map(() => true)
    writeFileSync(join(dir, "a.jsonl"), buildRecord({runId: "r1", mode: "none", passFlags, firstPassFlags: passFlags, firstPassRate: 1.0}))
    writeFileSync(join(dir, "b.jsonl"), buildRecord({runId: "r2", mode: "none", model: "other/model", passFlags, firstPassFlags: passFlags, firstPassRate: 1.0}))
    const {code, stderr} = await runCli(dir)
    assert.equal(code, 1)
    assert.ok(stderr.includes("model_version"))
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("malformed record (no summary line) exits 1 naming the file", async () => {
  const dir = tmpDir()
  try {
    const passFlags = STAGES.map(() => true)
    const good = buildRecord({runId: "r1", mode: "none", passFlags, firstPassFlags: passFlags, firstPassRate: 1.0})
    // Drop the summary line (last line).
    const bad = good.split("\n").slice(0, -2).join("\n") + "\n"
    writeFileSync(join(dir, "a.jsonl"), good)
    writeFileSync(join(dir, "b.jsonl"), bad)
    const {code, stderr} = await runCli(dir)
    assert.equal(code, 1)
    assert.ok(stderr.includes("b.jsonl"))
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("first_pass_rate_mean and per_stage.first_pass_failures are computed correctly", async () => {
  const dir = tmpDir()
  try {
    // Record 1: S2 first_pass false but pass true; first_pass_rate 0.9.
    const passFlags = STAGES.map(() => true)
    const fp1 = STAGES.map(() => true)
    fp1[2] = false
    writeFileSync(join(dir, "a.jsonl"), buildRecord({runId: "r1", mode: "none", passFlags, firstPassFlags: fp1, firstPassRate: 0.9}))
    // Record 2: all first_pass true; first_pass_rate 1.0.
    const fp2 = STAGES.map(() => true)
    writeFileSync(join(dir, "b.jsonl"), buildRecord({runId: "r2", mode: "none", passFlags, firstPassFlags: fp2, firstPassRate: 1.0}))
    const {code} = await runCli(dir)
    assert.equal(code, 0)
    const b = readBaseline(dir)
    const none = b.modes as Record<string, {first_pass_rate_mean: number; per_stage: Record<string, {first_pass_failures: number}>}>
    assert.equal(none.none.first_pass_rate_mean, 0.95)
    assert.equal(none.none.per_stage.S2.first_pass_failures, 1)
    assert.equal(none.none.per_stage.S0.first_pass_failures, 0)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("mismatched reasoning_effort across records exits 1", async () => {
  const dir = tmpDir()
  try {
    const passFlags = STAGES.map(() => true)
    writeFileSync(join(dir, "a.jsonl"), buildRecord({runId: "r1", mode: "none", passFlags, firstPassFlags: passFlags, firstPassRate: 1.0}))
    writeFileSync(join(dir, "b.jsonl"), buildRecord({runId: "r2", mode: "none", effort: "low", passFlags, firstPassFlags: passFlags, firstPassRate: 1.0}))
    const {code, stderr} = await runCli(dir)
    assert.equal(code, 1)
    assert.ok(stderr.includes("reasoning_effort"))
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})
