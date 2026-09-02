/**
 * JSONL run-record store. One line per run; append-only. The record schema is
 * documented in evals/README.md and versioned via `schema_version`.
 */
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Score } from "./scorer/types.ts";

export const RUN_RECORD_SCHEMA_VERSION = 1;

export interface RunRecord {
  schema_version: number;
  run_id: string;
  scenario: string;
  skill_bundle: { name: string; version: string };
  model: { id: string; reasoning_effort: string | null };
  started_at: string;
  ended_at: string;
  wall_time_s: number;
  env: { env_id: string | null; image: string; attempt: number };
  readiness: {
    ok: boolean;
    attempts: number;
    services_healthy_at: string | null;
    tools_present: boolean | null;
    aborted: boolean;
    abort_reason: string | null;
  };
  agent: {
    task_id: string | null;
    status: string | null;
    turns: number | null;
    tokens_in: number | null;
    tokens_out: number | null;
    tool_calls: number;
    tool_errors: number;
  };
  score: Score | null;
  error: string | null;
}

export function appendRunRecord(path: string, record: RunRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(record) + "\n", "utf8");
}

export function readRunRecords(path: string): RunRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RunRecord);
}

/** pass@1 / pass@k aggregation over a set of records for one scenario. */
export function summarize(records: RunRecord[]) {
  const scored = records.filter((r) => r.score !== null);
  const agentComplete = scored.filter((r) => r.score?.funnel.agentComplete);
  return {
    runs: records.length,
    scored: scored.length,
    aborted: records.filter((r) => r.readiness.aborted).length,
    agentComplete: agentComplete.length,
    passAt1: scored.length > 0 ? agentComplete.length / scored.length : null,
    meanFirstPassRate:
      scored.length > 0
        ? scored.reduce((sum, r) => sum + (r.score?.metrics.firstPassRate ?? 0), 0) / scored.length
        : null,
    meanWallTimeS:
      scored.length > 0 ? scored.reduce((sum, r) => sum + r.wall_time_s, 0) / scored.length : null,
    meanTokensOut:
      scored.length > 0
        ? scored.reduce((sum, r) => sum + (r.agent.tokens_out ?? 0), 0) / scored.length
        : null,
  };
}
