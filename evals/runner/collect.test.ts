// collect.test.ts — unit smoke for the score-input normalizer (locked D1).
// normalizeScoreInput is the boundary that turns the LLM collector's raw
// score-input.json into the typed ScoreInput the scorer trusts.
import {test} from "node:test"
import assert from "node:assert/strict"
import {normalizeScoreInput} from "./collect.ts"

test("normalizeScoreInput maps a complete raw score-input", () => {
  const {scoreInput, notes} = normalizeScoreInput({
    run_id: "run-1",
    draft: {
      required_source_files: {
        "connector.ts": true,
        "config-schema.json": true,
        "runtime-schema.json": true,
        "capabilities.json": true,
      },
      source_files: [{path: "connector.ts", content: "x"}],
      config_schema: {fields: [{name: "api-token", is_secret: true}]},
      runtime_schema: {fields: [{name: "api-token", isSecret: true}]},
    },
    connector_config: {"base-url": "http://x", "account-email": "a@b.c", "api-token": "t"},
    evidence: {result: "PASS"},
    build_run: {state: "RUN_STATE_SUCCEEDED"},
    tenant_counts: {users: 0, groups: 0, memberships: 0},
    resource_ids: {users: [], groups: []},
  })
  assert.equal(scoreInput.run_id, "run-1")
  assert.equal(scoreInput.draft.required_source_files["connector.ts"], true)
  assert.equal(scoreInput.draft.config_schema.fields[0].is_secret, true)
  // isSecret (config-schema.json) normalized to is_secret.
  assert.equal(scoreInput.draft.runtime_schema.fields[0].is_secret, true)
  assert.equal(scoreInput.evidence.result, "PASS")
  assert.equal(scoreInput.build_run.state, "RUN_STATE_SUCCEEDED")
  assert.equal(notes.length, 0)
})

test("normalizeScoreInput is fail-safe on missing fields (null, never crash)", () => {
  const {scoreInput, notes} = normalizeScoreInput({})
  assert.equal(scoreInput.run_id, "")
  assert.equal(scoreInput.draft.required_source_files["connector.ts"], false)
  assert.equal(scoreInput.draft.source_files.length, 0)
  assert.equal(scoreInput.connector_config["api-token"], undefined)
  assert.equal(scoreInput.evidence.result, undefined)
  assert.equal(scoreInput.build_run.state, undefined)
  assert.equal(scoreInput.tenant_counts.users, null)
  assert.ok(notes.length > 0)
})

test("normalizeScoreInput rejects non-object roots and arrays", () => {
  for (const bad of [null, 42, "x", [1, 2]]) {
    const {scoreInput} = normalizeScoreInput(bad)
    assert.equal(scoreInput.run_id, "")
  }
})
