// baseline.ts — baseline aggregator (CXF-217, D16).
// Reads every *.jsonl run record in the out dir, strictly parses each, and
// computes the locked v1 baseline schema deterministically (run ids sorted,
// scenario ids sorted, stages in canonical S0–S11 order).
// Usage: node evals/runner/baseline.ts [--out <dir>]   (default evals/results)
import {readdirSync, readFileSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import {argv, exit, stdout} from "node:process"

const STAGES = Array.from({length: 12}, (_, i) => `S${i}`)

interface StageRow {
  stage: string
  pass: boolean
  first_pass: boolean
}

interface RunRecord {
  runId: string
  scenario: string
  mode: string
  modelVersion: string
  reasoningEffort: string
  stages: Map<string, StageRow>
  firstPassRate: number
}

function usage(): void {
  process.stderr.write("usage: node evals/runner/baseline.ts [--out <dir>]\n")
}

function parseJson(file: string, line: number, text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    process.stderr.write(`ERROR: ${file}:${line}: not valid JSON\n`)
    exit(1)
  }
}

// Strict parse per file (D16): line 1 meta, last line summary, middle lines
// stage/skipped rows, exactly the 12 canonical stage rows S0–S11.
function parseRecord(file: string, lines: string[]): RunRecord {
  const fail = (line: number, msg: string): never => {
    process.stderr.write(`ERROR: ${file}:${line}: ${msg}\n`)
    exit(1)
  }

  const meta = parseJson(file, 1, lines[0])
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    fail(1, "meta line must be a JSON object")
  }
  const m = meta as Record<string, unknown>
  for (const key of ["run_id", "scenario", "skill_bundle_mode", "model_version", "reasoning_effort"]) {
    const v = m[key]
    if (typeof v !== "string" || v.length === 0) {
      fail(1, `meta field ${key} missing or not a non-empty string`)
    }
  }

  const lastIdx = lines.length - 1
  const summary = parseJson(file, lastIdx + 1, lines[lastIdx])
  if (typeof summary !== "object" || summary === null || Array.isArray(summary)) {
    fail(lastIdx + 1, "summary line must be a JSON object")
  }
  const s = summary as Record<string, unknown>
  if (s.summary !== true) {
    fail(lastIdx + 1, "summary line must have summary === true")
  }
  if (typeof s.first_pass_rate !== "number" || !Number.isFinite(s.first_pass_rate)) {
    fail(lastIdx + 1, "summary field first_pass_rate must be numeric")
  }

  const stages = new Map<string, StageRow>()
  for (let i = 1; i < lastIdx; i++) {
    const row = parseJson(file, i + 1, lines[i])
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      fail(i + 1, "row must be a JSON object")
    }

    const r = row as Record<string, unknown>
    if (r.pass === "skipped_human_boundary") continue
    const stage = r.stage as string
    if (typeof stage !== "string" || !STAGES.includes(stage)) {
      fail(i + 1, `row stage ${String(stage)} not in canonical S0..S11`)
    }
    if (typeof r.pass !== "boolean") {
      fail(i + 1, `stage ${stage} pass must be boolean`)
    }
    if (typeof r.first_pass !== "boolean") {
      fail(i + 1, `stage ${stage} first_pass must be boolean`)
    }
    if (stages.has(stage)) {
      fail(i + 1, `duplicate stage row ${stage}`)
    }
    stages.set(stage, {stage, pass: r.pass as boolean, first_pass: r.first_pass as boolean})
  }
  if (stages.size !== STAGES.length) {
    fail(1, `record must have exactly the 12 canonical stage rows S0..S11 (found ${stages.size})`)
  }

  return {
    runId: m.run_id as string,
    scenario: m.scenario as string,
    mode: m.skill_bundle_mode as string,
    modelVersion: m.model_version as string,
    reasoningEffort: m.reasoning_effort as string,
    stages,
    firstPassRate: s.first_pass_rate as number,
  }
}

function computeModeBlock(recs: RunRecord[]): Record<string, unknown> {
  const runs = recs.length
  const passes = recs.filter((r) => STAGES.every((st) => r.stages.get(st)!.pass === true)).length
  const perStage: Record<string, unknown> = {}
  for (const st of STAGES) {
    const rows = recs.map((r) => r.stages.get(st)!)
    perStage[st] = {
      runs: rows.length,
      failures: rows.filter((row) => row.pass !== true).length,
      first_pass_failures: rows.filter((row) => row.first_pass === false).length,
    }
  }
  return {
    run_ids: recs.map((r) => r.runId).sort(),
    runs,
    passes,
    pass_rate: passes / runs,
    pass_at_3: passes > 0 ? 1 : 0,
    first_pass_rate_mean: recs.reduce((acc, r) => acc + r.firstPassRate, 0) / runs,
    per_stage: perStage,
  }
}

function main(): void {
  const args = argv.slice(2)
  let out = "evals/results"
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--help" || a === "-h") {
      usage()
      exit(0)
    } else if (a === "--out") {
      const v = args[++i]
      if (v === undefined || v === "") {
        process.stderr.write("ERROR: --out requires a non-empty value\n")
        usage()
        exit(1)
      }
      out = v
    } else {
      process.stderr.write(`unknown argument: ${a}\n`)
      usage()
      exit(1)
    }
  }

  let files: string[]
  try {
    files = readdirSync(out).filter((f) => f.endsWith(".jsonl")).sort()
  } catch (err) {
    process.stderr.write(`ERROR: cannot read out dir ${out}: ${(err as Error).message}\n`)
    exit(1)
  }
  if (files.length === 0) {
    process.stderr.write(`ERROR: no *.jsonl files in ${out}\n`)
    exit(1)
  }

  const records: RunRecord[] = []
  for (const f of files) {
    let text: string
    try {
      text = readFileSync(join(out, f), "utf8")
    } catch (err) {
      process.stderr.write(`ERROR: cannot read ${join(out, f)}: ${(err as Error).message}\n`)
      exit(1)
    }
    const lines = text.split("\n")
    // writeRecord ends every file with "\n" — drop the single trailing empty line.
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
    if (lines.length === 0) {
      process.stderr.write(`ERROR: ${f}:1: empty record file\n`)
      exit(1)
    }
    records.push(parseRecord(f, lines))
  }

  // Cross-record consistency (D16): one shared model_version + reasoning_effort.
  const modelVersion = records[0].modelVersion
  const reasoningEffort = records[0].reasoningEffort
  const mismatched = records.filter(
    (r) => r.modelVersion !== modelVersion || r.reasoningEffort !== reasoningEffort,
  )
  if (mismatched.length > 0) {
    process.stderr.write(
      `ERROR: records disagree on model_version/reasoning_effort: ${mismatched.map((r) => r.runId).join(", ")}\n`,
    )
    exit(1)
  }

  const byMode = new Map<string, RunRecord[]>()
  for (const r of records) {
    const list = byMode.get(r.mode) ?? []
    list.push(r)
    byMode.set(r.mode, list)
  }
  const modes: Record<string, unknown> = {}
  for (const mode of [...byMode.keys()].sort()) {
    modes[mode] = computeModeBlock(byMode.get(mode)!)
  }

  // Pareto: per-stage failures summed across ALL records (all modes), sorted
  // by failures descending with tie-break stage id ascending.
  const stageFailures = new Map<string, number>()
  for (const r of records) {
    for (const st of STAGES) {
      if (r.stages.get(st)!.pass !== true) {
        stageFailures.set(st, (stageFailures.get(st) ?? 0) + 1)
      }
    }
  }
  const totalFailures = [...stageFailures.values()].reduce((a, b) => a + b, 0)
  const pareto =
    totalFailures === 0
      ? []
      : [...stageFailures.entries()]
          .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
          .map(([stage, failures]) => ({stage, failures, share: failures / totalFailures}))

  const obj = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    model: modelVersion,
    reasoning_effort: reasoningEffort,
    scenarios: [...new Set(records.map((r) => r.scenario))].sort(),
    modes,
    pareto,
  }
  const outPath = join(out, "baseline.json")
  writeFileSync(outPath, JSON.stringify(obj, null, 2) + "\n", "utf8")
  stdout.write(`baseline: ${outPath}\n`)
  exit(0)
}

main()
