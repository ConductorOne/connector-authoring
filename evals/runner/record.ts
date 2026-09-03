// record.ts — JSONL run record writer (CXF-216 PR 1, L25).
import {mkdirSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import type {Scenario} from "./scenario.ts"
import type {StageRow} from "./score.ts"

export interface RunMeta {
  run_id: string
  scenario: string
  skill_bundle_version: string
  skill_bundle_mode: string
  model_version: string
  harness: string
  reasoning_effort: string
  started_at: string
  wall_time_ms: number
  funnel_tools_present: boolean
}

export interface SummaryLine {
  summary: true
  funnel: string[]
  first_pass_rate: number
  recovery_cycles: number
  parity_verdict: string
  parity_evidence: string
  parity_tenant: string | Record<string, unknown>
  parity_tenant_evidence: string
  hygiene_verdict: string
  hygiene_evidence: string
  handoff_discipline_verdict: boolean
  tool_calls: number
  turns: number
  tokens_in: number | null
  tokens_out: number | null
}

// Run meta (locked D15): harness is inherited (no override); reasoning_effort
// comes from the scenario pin. Lives here (not run.ts) so tests can import
// it without executing the runner CLI.
export function buildRunMeta(
  runId: string,
  scenario: Scenario,
  harness: string,
  startedAt: string,
  wallTimeMs: number,
  funnelToolsPresent: boolean,
): RunMeta {
  return {
    run_id: runId,
    scenario: scenario.id,
    skill_bundle_version: scenario.skillBundle.version,
    skill_bundle_mode: scenario.skillBundle.mode,
    model_version: scenario.model,
    harness,
    reasoning_effort: scenario.reasoningEffort,
    started_at: startedAt,
    wall_time_ms: wallTimeMs,
    funnel_tools_present: funnelToolsPresent,
  }
}

export function writeRecord(
  runId: string,
  scenario: Scenario,
  meta: RunMeta,
  stageRows: StageRow[],
  skippedRows: {stage: string; gate: string}[],
  summary: SummaryLine,
  outDir: string,
): string {
  mkdirSync(outDir, {recursive: true})
  const lines: string[] = []
  lines.push(JSON.stringify(meta))
  for (const row of stageRows) {
    lines.push(JSON.stringify(row))
  }
  for (const skipped of skippedRows) {
    lines.push(JSON.stringify({stage: skipped.stage, gate: skipped.gate, pass: "skipped_human_boundary"}))
  }
  lines.push(JSON.stringify(summary))
  const filePath = join(outDir, `${runId}.jsonl`)
  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8")
  return filePath
}
