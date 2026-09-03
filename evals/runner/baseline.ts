// baseline.ts — baseline.json generator (CXF-217 PR 2, locked D16).
// Reads every *.jsonl run record in the results dir (or --out dir), strictly
// parses each record, and computes the locked v1 baseline schema: per-mode
// pass rates + pass@3 + first-pass-rate mean, per-stage failure counts, and
// the combined failure Pareto. Deterministic: run ids sorted, scenario ids
// sorted, stages in canonical S0–S11 order.
// Usage: node evals/runner/baseline.ts [--out <dir>]
import {readdirSync, readFileSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import {argv, exit, stderr, stdout} from "node:process"

const STAGES = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11"]

const META_FIELDS = ["run_id", "scenario", "skill_bundle_mode", "model_version", "reasoning_effort"]

function usage(): void {
  stdout.write("usage: node evals/runner/baseline.ts [--out <dir>]\n")
  stdout.write("  --out <dir>  results dir to scan for *.jsonl records (default evals/results)\n")
  stdout.write("  --help       print this usage and exit 0\n")
}

interface ParsedRecord {
  file: string
  meta: Record<string, unknown>
  stageRows: {stage: string; pass: boolean; first_pass: boolean}[]
  summary: {first_pass_rate: number}
}

function fail(msg: string): never {
  stderrWrite(msg)
  exit(1)
}

// Keep stderr writes local (imports are locked to node:process stdout only
// for the success path; errors go to stderr via process.stderr).
function stderrWrite(msg: string): void {
  stderr.write(msg + "\n")
}

function parseRecord(file: string, lines: string[]): ParsedRecord {
  const lineNo = (i: number) => `${file}:${i + 1}`
  if (lines.length < 14) {
    fail(`${lineNo(0)}: record has ${lines.length} lines; expected at least 14 (meta + 12 stages + summary)`)
  }
  let meta: Record<string, unknown>
  try {
    meta = JSON.parse(lines[0]) as Record<string, unknown>
  } catch {
    fail(`${lineNo(0)}: meta line is not valid JSON`)
  }
  for (const field of META_FIELDS) {
    const v = meta[field]
    if (typeof v !== "string" || v.length === 0) {
      fail(`${lineNo(0)}: meta field ${field} missing or not a non-empty string`)
    }
  }

  const stageRows: {stage: string; pass: boolean; first_pass: boolean}[] = []
  const seen = new Set<string>()
  for (let i = 1; i < lines.length - 1; i++) {
    let row: Record<string, unknown>
    try {
      row = JSON.parse(lines[i]) as Record<string, unknown>
    } catch {
      fail(`${lineNo(i)}: row is not valid JSON`)
    }
    if (row.pass === "skipped_human_boundary") {
      // Skipped row (S11b/S11c): excluded from pass computation; no stage
      // membership in the canonical S0–S11 set.
      continue
    }
    const stage = row.stage
    if (typeof stage !== "string" || !STAGES.includes(stage)) {
      fail(`${lineNo(i)}: row has stage ${JSON.stringify(stage)}; expected one of ${STAGES.join(",")} or a skipped row`)
    }
    if (typeof row.pass !== "boolean" || typeof row.first_pass !== "boolean") {
      fail(`${lineNo(i)}: stage row ${stage} must have boolean pass and first_pass`)
    }
    if (seen.has(stage)) {
      fail(`${lineNo(i)}: duplicate stage row ${stage}`)
    }
    seen.add(stage)
    stageRows.push({stage, pass: row.pass, first_pass: row.first_pass})
  }
  for (const stage of STAGES) {
    if (!seen.has(stage)) {
      fail(`${lineNo(0)}: record missing canonical stage row ${stage}`)
    }
  }

  let summary: Record<string, unknown>
  try {
    summary = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>
  } catch {
    fail(`${lineNo(lines.length - 1)}: summary line is not valid JSON`)
  }
  if (summary.summary !== true || typeof summary.first_pass_rate !== "number" || !Number.isFinite(summary.first_pass_rate)) {
    fail(`${lineNo(lines.length - 1)}: last line must be the summary (summary === true with numeric first_pass_rate)`)
  }

  return {file, meta, stageRows, summary: {first_pass_rate: summary.first_pass_rate}}
}

function main(): void {
  const args = argv.slice(2)
  let out = "evals/results"
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--help" || a === "-h") {
      usage()
      exit(0)
    }
    if (a === "--out") {
      if (i + 1 >= args.length) fail("--out requires a directory argument")
      out = args[++i]
      continue
    }
    fail(`unknown argument: ${a} (try --help)`)
  }

  let files: string[]
  try {
    files = readdirSync(out).filter((f) => f.endsWith(".jsonl")).sort()
  } catch (err) {
    fail(`cannot read results dir ${out}: ${(err as Error).message}`)
  }
  if (files.length === 0) {
    fail(`no *.jsonl records found in ${out}`)
  }

  const records: ParsedRecord[] = []
  for (const f of files) {
    let raw: string
    try {
      raw = readFileSync(join(out, f), "utf8")
    } catch (err) {
      fail(`cannot read ${join(out, f)}: ${(err as Error).message}`)
    }
    const lines = raw.split("\n").filter((l) => l.trim().length > 0)
    records.push(parseRecord(f, lines))
  }

  // Cross-record consistency: shared model_version + reasoning_effort.
  const model = records[0].meta.model_version as string
  const effort = records[0].meta.reasoning_effort as string
  const mismatched = records.filter(
    (r) => r.meta.model_version !== model || r.meta.reasoning_effort !== effort,
  )
  if (mismatched.length > 0) {
    fail(
      `records disagree on model_version/reasoning_effort: ${mismatched.map((r) => r.file).join(", ")} ` +
        `(expected ${model}/${effort})`,
    )
  }

  // Group by skill_bundle_mode (keys sorted).
  const byMode = new Map<string, ParsedRecord[]>()
  for (const r of records) {
    const mode = r.meta.skill_bundle_mode as string
    const list = byMode.get(mode) ?? []
    list.push(r)
    byMode.set(mode, list)
  }
  const modes: Record<string, unknown> = {}
  for (const mode of [...byMode.keys()].sort()) {
    const list = byMode.get(mode)!
    const runIds = list.map((r) => r.meta.run_id as string).sort()
    const passes = list.filter((r) => r.stageRows.every((s) => s.pass === true)).length
    const perStage: Record<string, {runs: number; failures: number; first_pass_failures: number}> = {}
    for (const stage of STAGES) {
      const rows = list.map((r) => r.stageRows.find((s) => s.stage === stage)).filter((s) => s !== undefined)
      perStage[stage] = {
        runs: rows.length,
        failures: rows.filter((s) => s!.pass !== true).length,
        first_pass_failures: rows.filter((s) => s!.first_pass === false).length,
      }
    }
    modes[mode] = {
      run_ids: runIds,
      runs: list.length,
      passes,
      pass_rate: list.length > 0 ? passes / list.length : 0,
      pass_at_3: passes > 0 ? 1 : 0,
      first_pass_rate_mean:
        list.length > 0 ? list.reduce((acc, r) => acc + r.summary.first_pass_rate, 0) / list.length : 0,
      per_stage: perStage,
    }
  }

  // Pareto: per-stage failures summed across ALL records, sorted descending
  // with tie-break stage id ascending; empty when totalFailures === 0.
  const stageFailures = new Map<string, number>()
  for (const r of records) {
    for (const s of r.stageRows) {
      if (s.pass !== true) stageFailures.set(s.stage, (stageFailures.get(s.stage) ?? 0) + 1)
    }
  }
  const totalFailures = [...stageFailures.values()].reduce((a, b) => a + b, 0)
  const pareto =
    totalFailures === 0
      ? []
      : [...stageFailures.entries()]
          .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
          .map(([stage, failures]) => ({stage, failures, share: failures / totalFailures}))

  const scenarios = [...new Set(records.map((r) => r.meta.scenario as string))].sort()

  const baseline = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    model,
    reasoning_effort: effort,
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
