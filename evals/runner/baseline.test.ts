// baseline.test.ts — unit smoke for the baseline aggregator (D17).
// Hand-built fixture JSONL records in a tmp dir, invoked via
// `node --experimental-strip-types evals/runner/baseline.ts --out <tmpdir>`
// (execFile pattern from run.test.ts).
import {test} from "node:test"
import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {promisify} from "node:util"
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"

const execFileAsync = promisify(execFile)
const BASELINE = "evals/runner/baseline.ts"

async function runCli(args: string[]): Promise<{code: number; stdout: string; stderr: string}> {
  try {
    const {stdout, stderr} = await execFileAsync("node", ["--experimental-strip-types", BASELINE, ...args], {
      cwd: process.cwd(),
      timeout: 30_000,
    })
    return {code: 0, stdout, stderr}
  } catch (err) {
    const e = err as {code?: number; stdout?: string; stderr?: string}
    return {code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? ""}
  }
}

// Build a full 16-line record: 1 meta line, 12 stage rows (S0–S11), 2
// skipped_human_boundary rows, 1 summary line (D17 fixture shapes).
function buildRecord(
  runId: string,
  mode: string,
  passFlags: boolean[],
  firstPassFlags: boolean[],
  firstPassRate: number,
  overrides: Record<string, unknown> = {},
): string {
  const meta = {
    run_id: runId,
    scenario: "tier1-directory",
    skill_bundle_version: "0.0.0",
    skill_bundle_mode: mode,
    model_version: "together/deepseek-ai/DeepSeek-V4-Flash-0731",
    harness: "inherit",
    reasoning_effort: "high",
    started_at: "2026-09-02T12:00:00.000Z",
    wall_time_ms: 123456,
    funnel_tools_present: true,
    ...overrides,
  }
  const lines: string[] = [JSON.stringify(meta)]
  for (let i = 0; i < 12; i++) {
    lines.push(
      JSON.stringify({
        stage: `S${i}`,
        gate: `gate-${i}`,
        pass: passFlags[i],
        first_pass: firstPassFlags[i],
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
      funnel: passFlags.map((_, i) => `S${i}`),
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
    }),
  )
  return lines.join("\n") + "\n"
}

const ALL_PASS = Array.from({length: 12}, () => true)
const ALL_FIRST = Array.from({length: 12}, () => true)

function readBaseline(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "baseline.json"), "utf8")) as Record<string, unknown>
}

test("--help exits 0 with usage", async () => {
  const {code, stdout, stderr} = await runCli(["--help"])
  assert.equal(code, 0)
  assert.ok((stdout + stderr).includes("usage: node evals/runner/baseline.ts"))
})

test("unknown args exit 1", async () => {
  const {code} = await runCli(["--bogus"])
  assert.equal(code, 1)
})

test("(a) pass/fail mix computes pass_rate, per_stage.failures, and pareto", async () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-baseline-"))
  try {
    writeFileSync(join(dir, "a-pass.jsonl"), buildRecord("a-pass", "none", ALL_PASS, ALL_FIRST, 1.0))
    const failFlags = [...ALL_PASS]
    failFlags[3] = false
    writeFileSync(join(dir, "b-fail.jsonl"), buildRecord("b-fail", "none", failFlags, ALL_FIRST, 0.9))
    const {code} = await runCli(["--out", dir])
    assert.equal(code, 0)
    const b = readBaseline(dir)
    const none = (b.modes as Record<string, Record<string, unknown>>).none
    assert.equal(none.runs, 2)
    assert.equal(none.passes, 1)
    assert.equal(none.pass_rate, 0.5)
    const perStage = none.per_stage as Record<string, Record<string, unknown>>
    assert.equal(perStage.S3.failures, 1)
    assert.equal(perStage.S0.failures, 0)
    const pareto = b.pareto as {stage: string; failures: number; share: number}[]
    assert.deepEqual(pareto, [{stage: "S3", failures: 1, share: 1}])
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(b) skipped rows are excluded from pass computation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-baseline-"))
  try {
    writeFileSync(join(dir, "a.jsonl"), buildRecord("a", "none", ALL_PASS, ALL_FIRST, 1.0))
    const {code} = await runCli(["--out", dir])
    assert.equal(code, 0)
    const b = readBaseline(dir)
    const none = (b.modes as Record<string, Record<string, unknown>>).none
    assert.equal(none.passes, 1)
    assert.equal(none.pass_rate, 1)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(c) all-pass records produce an empty pareto", async () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-baseline-"))
  try {
    writeFileSync(join(dir, "a.jsonl"), buildRecord("a", "none", ALL_PASS, ALL_FIRST, 1.0))
    writeFileSync(join(dir, "b.jsonl"), buildRecord("b", "none", ALL_PASS, ALL_FIRST, 1.0))
    const {code} = await runCli(["--out", dir])
    assert.equal(code, 0)
    const b = readBaseline(dir)
    assert.deepEqual(b.pareto, [])
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(d) multi-mode grouping sorts modes keys and per-mode run_ids", async () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-baseline-"))
  try {
    // Filenames sort "b-*" before "a-*"; modes must still be keyed sorted.
    writeFileSync(join(dir, "b-guide.jsonl"), buildRecord("b-guide", "guide-only", ALL_PASS, ALL_FIRST, 1.0))
    writeFileSync(join(dir, "a-none.jsonl"), buildRecord("a-none", "none", ALL_PASS, ALL_FIRST, 1.0))
    writeFileSync(join(dir, "c-none.jsonl"), buildRecord("c-none", "none", ALL_PASS, ALL_FIRST, 1.0))
    const {code} = await runCli(["--out", dir])
    assert.equal(code, 0)
    const b = readBaseline(dir)
    assert.deepEqual(Object.keys(b.modes as Record<string, unknown>), ["guide-only", "none"])
    const none = (b.modes as Record<string, Record<string, unknown>>).none
    assert.deepEqual(none.run_ids, ["a-none", "c-none"])
    const guide = (b.modes as Record<string, Record<string, unknown>>)["guide-only"]
    assert.deepEqual(guide.run_ids, ["b-guide"])
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(e) mismatched model_version across records exits 1", async () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-baseline-"))
  try {
    writeFileSync(join(dir, "a.jsonl"), buildRecord("a", "none", ALL_PASS, ALL_FIRST, 1.0))
    writeFileSync(
      join(dir, "b.jsonl"),
      buildRecord("b", "none", ALL_PASS, ALL_FIRST, 1.0, {model_version: "other/model"}),
    )
    const {code, stderr} = await runCli(["--out", dir])
    assert.equal(code, 1)
    assert.ok(stderr.includes("model_version"))
    assert.ok(stderr.includes("b"))
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(f) malformed record (no summary line) exits 1 naming file + line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-baseline-"))
  try {
    const lines = buildRecord("a", "none", ALL_PASS, ALL_FIRST, 1.0).trim().split("\n")
    writeFileSync(join(dir, "a.jsonl"), lines.slice(0, -1).join("\n") + "\n")
    const {code, stderr} = await runCli(["--out", dir])
    assert.equal(code, 1)
    assert.ok(stderr.includes("a.jsonl"))
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(g) first_pass_rate_mean and per_stage.first_pass_failures are computed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-baseline-"))
  try {
    // S2 passed on a retry: first_pass false, pass true.
    const retryFlags = [...ALL_FIRST]
    retryFlags[2] = false
    writeFileSync(join(dir, "a.jsonl"), buildRecord("a", "none", ALL_PASS, retryFlags, 0.9))
    writeFileSync(join(dir, "b.jsonl"), buildRecord("b", "none", ALL_PASS, ALL_FIRST, 1.0))
    const {code} = await runCli(["--out", dir])
    assert.equal(code, 0)
    const b = readBaseline(dir)
    const none = (b.modes as Record<string, Record<string, unknown>>).none
    assert.equal(none.first_pass_rate_mean, 0.95)
    const perStage = none.per_stage as Record<string, Record<string, unknown>>
    assert.equal(perStage.S2.first_pass_failures, 1)
    assert.equal(perStage.S0.first_pass_failures, 0)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(h) mismatched reasoning_effort across records exits 1", async () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-baseline-"))
  try {
    writeFileSync(join(dir, "a.jsonl"), buildRecord("a", "none", ALL_PASS, ALL_FIRST, 1.0))
    writeFileSync(
      join(dir, "b.jsonl"),
      buildRecord("b", "none", ALL_PASS, ALL_FIRST, 1.0, {reasoning_effort: "low"}),
    )
    const {code, stderr} = await runCli(["--out", dir])
    assert.equal(code, 1)
    assert.ok(stderr.includes("reasoning_effort"))
    assert.ok(stderr.includes("b"))
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(i) pass_at_3 is 1 when any run passes and 0 when none do", async () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-baseline-"))
  try {
    // none: one pass of two -> pass_at_3 1; guide-only: all fail -> 0.
    writeFileSync(join(dir, "a-pass.jsonl"), buildRecord("a-pass", "none", ALL_PASS, ALL_FIRST, 1.0))
    const failFlags = [...ALL_PASS]
    failFlags[5] = false
    writeFileSync(join(dir, "b-fail.jsonl"), buildRecord("b-fail", "none", failFlags, ALL_FIRST, 0.9))
    writeFileSync(join(dir, "c-fail.jsonl"), buildRecord("c-fail", "guide-only", failFlags, ALL_FIRST, 0.9))
    const {code} = await runCli(["--out", dir])
    assert.equal(code, 0)
    const b = readBaseline(dir)
    const modes = b.modes as Record<string, Record<string, unknown>>
    assert.equal(modes.none.pass_at_3, 1)
    assert.equal(modes["guide-only"].pass_at_3, 0)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test("(j) scenarios field is the sorted distinct scenario ids across records", async () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-baseline-"))
  try {
    // guide-only records carry their own scenario id (locked decision 4).
    writeFileSync(join(dir, "a.jsonl"), buildRecord("a", "none", ALL_PASS, ALL_FIRST, 1.0))
    writeFileSync(
      join(dir, "b.jsonl"),
      buildRecord("b", "guide-only", ALL_PASS, ALL_FIRST, 1.0, {scenario: "tier1-directory-guide-only"}),
    )
    const {code} = await runCli(["--out", dir])
    assert.equal(code, 0)
    const b = readBaseline(dir)
    assert.deepEqual(b.scenarios, ["tier1-directory", "tier1-directory-guide-only"])
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})
