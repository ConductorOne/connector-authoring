// record.test.ts — unit smoke for the JSONL record writer (locked D4/L25).
// A synthetic scored run must produce the 16-line record shape: 1 meta line,
// 12 stage rows (S0-S11), 2 skipped_human_boundary rows, 1 summary line.
import {test} from "node:test"
import assert from "node:assert/strict"
import {mkdtempSync, readFileSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {writeRecord, type RunMeta, type SummaryLine} from "./record.ts"
import type {Scenario} from "./scenario.ts"
import type {StageRow} from "./score.ts"

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
  skillBundle: {mode: "none", version: "0.0.0"},
  model: "together/deepseek-ai/DeepSeek-V4-Flash-0731",
  requiredSourceFiles: ["connector.ts", "config-schema.json", "runtime-schema.json", "capabilities.json"],
  readinessTools: [
    "c1_connector_authoring_get_authoring_guide",
    "c1_connector_authoring_create_draft",
    "c1_connector_authoring_build_bundle",
    "c1_connector_authoring_run_draft_test_sync",
    "c1_connector_authoring_get_test_run_evidence",
  ],
  handoffPath: "/current-tasks/evals/<run-id>/handoff.json",
}

const META: RunMeta = {
  run_id: "evals-tier1-directory-20260902-120000-000",
  scenario: "tier1-directory",
  skill_bundle_version: "0.0.0",
  skill_bundle_mode: "none",
  model_version: "together/deepseek-ai/DeepSeek-V4-Flash-0731",
  harness: "inherit",
  reasoning_effort: "inherit",
  started_at: "2026-09-02T12:00:00.000Z",
  wall_time_ms: 123456,
  funnel_tools_present: true,
}

function stageRow(stage: string, pass: boolean): StageRow {
  return {stage, gate: stage, pass, first_pass: pass, attempts: 1, evidence: "ok"}
}

const SUMMARY: SummaryLine = {
  summary: true,
  funnel: ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11"],
  first_pass_rate: 1.0,
  recovery_cycles: 0,
  parity_verdict: "PASS",
  parity_evidence: "all 5 static source checks pass (account_id, user.title, totalPath, config literals, newUserResource + user.id)",
  parity_tenant: "not_applicable",
  parity_tenant_evidence: "draft test did not persist synced resources (tenant counts 0) — parity measured statically from source",
  hygiene_verdict: "PASS",
  hygiene_evidence: "all 4 files present; dual-schema parity; api-token secret in both; no plaintext fixture-token; bundle caps respected",
  handoff_discipline_verdict: true,
  tool_calls: 42,
  turns: 8,
  tokens_in: null,
  tokens_out: null,
}

test("writeRecord produces the 16-line JSONL shape", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-record-"))
  try {
    const rows = Array.from({length: 12}, (_, i) => stageRow(`S${i}`, true))
    const path = writeRecord(META.run_id, SCENARIO, META, rows, [
      {stage: "S11b", gate: "REVISION_STATUS_ACTIVE"},
      {stage: "S11c", gate: "SYNC_STATUS_DONE"},
    ], SUMMARY, dir)
    const lines = readFileSync(path, "utf8").trim().split("\n")
    assert.equal(lines.length, 16)
    const meta = JSON.parse(lines[0]) as Record<string, unknown>
    assert.equal(meta.run_id, META.run_id)
    assert.equal(meta.funnel_tools_present, true)
    const stageLines = lines.slice(1, 13).map((l) => JSON.parse(l) as Record<string, unknown>)
    assert.deepEqual(stageLines.map((l) => l.stage), Array.from({length: 12}, (_, i) => `S${i}`))
    for (const l of stageLines) {
      assert.equal(typeof l.pass, "boolean")
      assert.equal(typeof l.first_pass, "boolean")
      assert.equal(typeof l.attempts, "number")
      assert.equal(typeof l.evidence, "string")
    }
    const skipped = lines.slice(13, 15).map((l) => JSON.parse(l) as Record<string, unknown>)
    assert.equal(skipped[0].stage, "S11b")
    assert.equal(skipped[0].pass, "skipped_human_boundary")
    assert.equal(skipped[1].stage, "S11c")
    assert.equal(skipped[1].pass, "skipped_human_boundary")
    const summary = JSON.parse(lines[15]) as Record<string, unknown>
    assert.equal(summary.summary, true)
    assert.equal(summary.first_pass_rate, 1.0)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})
