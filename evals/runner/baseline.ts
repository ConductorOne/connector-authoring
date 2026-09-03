// baseline.ts — JSONL run records -> baseline.json (CXF-217, locked D16).
// Reads every *.jsonl record in the out dir, computes the locked v1 baseline
// schema deterministically, and writes baseline.json next to the records.
// CLI: node evals/runner/baseline.ts [--out <dir>] (default evals/results).
import {readdirSync, readFileSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import {argv, exit, stdout} from "node:process"

const STAGES = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11"]

// Locked D16: the baseline matrix is tier1-directory × {none, guide-only}.
const MODES = ["none", "guide-only"]

interface StageRow {
  pass: boolean
  firstPass: boolean
}

interface RunRecord {
  file: string
  runId: string
  scenario: string
  mode: string
  modelVersion: string
  reasoningEffort: string
  stageRows: Map<string, StageRow>
  firstPassRate: number
}

function usage(): void {
  console.error("usage: node evals/runner/baseline.ts [--out <dir>]")
}

function fail(file: string, line: number, detail: string): never {
  console.error(`ERROR: ${file}:${line}: ${detail}`)
  exit(1)
}

function parseLine(file: string, lineNo: number, line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    fail(file, lineNo, "line is not valid JSON")
  }
}

function parseRecord(file: string, lines: string[]): RunRecord {
  // Line 1 must be the meta with the five locked non-empty string fields.
  const metaRaw = parseLine(file, 1, lines[0])
  if (typeof metaRaw !== "object" || metaRaw === null || Array.isArray(metaRaw)) {
    fail(file, 1, "meta line must be a JSON object")
  }
  const meta = metaRaw as Record<string, unknown>
  for (const key of ["run_id", "scenario", "skill_bundle_mode", "model_version", "reasoning_effort"]) {
    const v = meta[key]
    if (typeof v !== "string" || v.length === 0) {
      fail(file, 1, `meta field ${key} missing or not a non-empty string`)
    }
  }
const runId = meta.run_id as string
  const scenario = meta.scenario as string
  const mode = meta.skill_bundle_mode as string
  const modelVersion = meta.model_version as string
  const reasoningEffort = meta.reasoning_effort as string
  if (!MODES.includes(mode)) {
    fail(file, 1, `meta skill_bundle_mode must be one of ${MODES.join(",")}`)
  }

  // The last line must be the summary.
  const lastIdx = lines.length - 1
  const summaryRaw = parseLine(file, lastIdx + 1, lines[lastIdx])
  if (typeof summaryRaw !== "object" || summaryRaw === null || Array.isArray(summaryRaw)) {
    fail(file, lastIdx + 1, "summary line must be a JSON object")
  }
  const summary = summaryRaw as Record<string, unknown>
  if (summary.summary !== true) {
    fail(file, lastIdx + 1, "summary line must have summary === true")
  }
  if (typeof summary.first_pass_rate !== "number" || !Number.isFinite(summary.first_pass_rate)) {
    fail(file, lastIdx + 1, "summary line must have a numeric first_pass_rate")
  }
  const firstPassRate = summary.first_pass_rate as number

  // Every line between must be a stage row or a skipped row.
  const stageRows = new Map<string, StageRow>()
  for (let i = 1; i < lastIdx; i++) {
    const lineNo = i + 1
    const rowRaw = parseLine(file, lineNo, lines[i])
    if (typeof rowRaw !== "object" || rowRaw === null || Array.isArray(rowRaw)) {
      fail(file, lineNo, "row must be a JSON object")
    }
    const row = rowRaw as Record<string, unknown>
    if (row.pass === "skipped_human_boundary") {
      // Skipped row (S11b/S11c): excluded from pass computation.
      continue
    }
    const stage = row.stage
    if (typeof stage !== "string" || !STAGES.includes(stage)) {
      fail(file, lineNo, `row stage must be one of ${STAGES.join(",")}`)
    }
    if (typeof row.pass !== "boolean" || typeof row.first_pass !== "boolean") {
      fail(file, lineNo, "stage row must have boolean pass and first_pass")
    }
    if (stageRows.has(stage)) {
      fail(file, lineNo, `duplicate stage row ${stage}`)
    }
    stageRows.set(stage, {pass: row.pass as boolean, firstPass: row.first_pass as boolean})
  }

  // A record must have exactly the 12 canonical stage rows.
  for (const stage of STAGES) {
    if (!stageRows.has(stage)) {
      fail(file, 0, `record missing canonical stage row ${stage}`)
    }
  }

  return {file, runId, scenario, mode, modelVersion, reasoningEffort, stageRows, firstPassRate}
}

function main(): void {
  const args = argv.slice(2)
  let out = "evals/results"
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--out") {
      out = args[++i] ?? ""
      if (out === "") {
        console.error("ERROR: --out requires a non-empty value")
        exit(1)
      }
    } else if (a === "--help" || a === "-h") {
      usage()
      exit(0)
    } else {
      console.error(`unknown argument: ${a}`)
      usage()
      exit(1)
    }
  }

  let files: string[]
  try {
    files = readdirSync(out).filter((f) => f.endsWith(".jsonl")).sort()
  } catch (err) {
    console.error(`ERROR: cannot read out dir ${out}: ${(err as Error).message}`)
    exit(1)
  }
  if (files.length === 0) {
    console.error(`ERROR: no *.jsonl records found in ${out}`)
    exit(1)
  }

  const records: RunRecord[] = []
  for (const f of files) {
    let content: string
    try {
      content = readFileSync(join(out, f), "utf8")
    } catch (err) {
      console.error(`ERROR: cannot read ${join(out, f)}: ${(err as Error).message}`)
      exit(1)
    }
    const lines = content.split("\n")
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
    if (lines.length < 3) {
      fail(f, 0, "record has fewer than 3 lines (meta + stages + summary)")
    }
    records.push(parseRecord(f, lines))
  }

  // Cross-record consistency: shared model_version and reasoning_effort.
  const modelVersion = records[0].modelVersion
  const reasoningEffort = records[0].reasoningEffort
  for (const r of records) {
    if (r.modelVersion !== modelVersion) {
      console.error(`ERROR: mismatched model_version: ${r.file} (${r.modelVersion}) vs ${records[0].file} (${modelVersion})`)
      exit(1)
    }
    if (r.reasoningEffort !== reasoningEffort) {
      console.error(`ERROR: mismatched reasoning_effort: ${r.file} (${r.reasoningEffort}) vs ${records[0].file} (${reasoningEffort})`)
      exit(1)
    }
  }

  // Group by skill_bundle_mode (keys sorted; run_ids sorted ascending).
  const byMode = new Map<string, RunRecord[]>()
  for (const r of records) {
    const list = byMode.get(r.mode) ?? []
    list.push(r)
    byMode.set(r.mode, list)
  }
  const modes: Record<string, unknown> = {}
  for (const mode of [...byMode.keys()].sort()) {
    const list = byMode.get(mode) as RunRecord[]
    list.sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0))
    const runs = list.length
    const passes = list.filter((r) => STAGES.every((s) => (r.stageRows.get(s) as StageRow).pass)).length
    const perStage: Record<string, unknown> = {}
    for (const stage of STAGES) {
      const rows = list.map((r) => r.stageRows.get(stage) as StageRow)
      perStage[stage] = {
        runs: rows.length,
        failures: rows.filter((row) => row.pass !== true).length,
        first_pass_failures: rows.filter((row) => row.firstPass === false).length,
      }
    }
    modes[mode] = {
      run_ids: list.map((r) => r.runId),
      runs,
      passes,
      pass_rate: passes / runs,
      pass_at_3: passes > 0 ? 1 : 0,
      first_pass_rate_mean: list.reduce((sum, r) => sum + r.firstPassRate, 0) / runs,
      per_stage: perStage,
    }
  }

  // Pareto: per-stage failures summed across ALL records, sorted by failures
  // descending with tie-break stage id ascending; empty when no failures.
  const stageFailures = new Map<string, number>()
  for (const r of records) {
    for (const stage of STAGES) {
      const row = r.stageRows.get(stage) as StageRow
      if (row.pass !== true) {
        stageFailures.set(stage, (stageFailures.get(stage) ?? 0) + 1)
      }
    }
  }
  const totalFailures = [...stageFailures.values()].reduce((a, b) => a + b, 0)
  const pareto =
    totalFailures === 0
      ? []
      : [...stageFailures.entries()]
          .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1))
          .map(([stage, failures]) => ({stage, failures, share: failures / totalFailures}))

  const scenarios = [...new Set(records.map((r) => r.scenario))].sort()

  const baseline = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    model: modelVersion,
    reasoning_effort: reasoningEffort,
    scenarios,
    modes,
    pareto,
  }

  const outPath = join(out, "baseline.json")
  writeFileSync(outPath, JSON.stringify(baseline, null, 2) + "\n", "utf8")
  stdout.write(`baseline: ${outPath}\n`)
  exit(0)
}

main()
