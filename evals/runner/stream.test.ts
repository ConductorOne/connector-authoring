// stream.test.ts — unit smoke for the firehose parser (locked L33).
// Uses the REAL stream envelope shapes verified 2026-09-02:
//   tool_call:   {type, message: <name>, data: {input: {...}}}
//   tool_result: {type, message: <result text>, data: {tool_name, is_error}}
import {test} from "node:test"
import assert from "node:assert/strict"
import {parseStream, stageForTool} from "./stream.ts"

function toolCall(name: string, input?: Record<string, unknown>): Record<string, unknown> {
  return {type: "tool_call", message: name, data: {input: input ?? {}}}
}

function toolResult(name: string, message: string, isError = false): Record<string, unknown> {
  return {type: "tool_result", message, data: {tool_name: name, is_error: isError}}
}

test("stageForTool maps the full funnel surface", () => {
  assert.equal(stageForTool("c1_connector_authoring_get_authoring_guide"), "S0")
  assert.equal(stageForTool("c1_connector_authoring_create_draft"), "S1")
  assert.equal(stageForTool("c1_connector_authoring_create_draft_source_upload"), "S2")
  assert.equal(stageForTool("c1_connector_authoring_get_draft"), "S3")
  assert.equal(stageForTool("c1_connector_authoring_build_bundle"), "S4")
  assert.equal(stageForTool("c1_connector_authoring_get_run"), "S5")
  assert.equal(stageForTool("c1_apps_create"), "S6")
  assert.equal(stageForTool("c1_connector_authoring_provision_connector"), "S7")
  assert.equal(stageForTool("c1_connector_service_update"), "S8")
  assert.equal(stageForTool("c1_connector_authoring_run_draft_test_sync"), "S9")
  assert.equal(stageForTool("c1_connector_authoring_get_test_run_evidence"), "S10")
  assert.equal(stageForTool("c1_connector_authoring_deploy_connector_instance"), "S11")
assert.equal(stageForTool("c1_connector_authoring_mint_approval_token"), "S11")
  assert.equal(stageForTool("driver.write_file"), null)
  assert.equal(stageForTool("driver.complete_run"), null)
})

test("parseStream detects failures via data.is_error (the real signal)", () => {
  const events = [
    toolCall("c1_connector_authoring_get_authoring_guide"),
    toolResult("c1_connector_authoring_get_authoring_guide", "boom", true),
  ]
  const parsed = parseStream(events)
  assert.equal(parsed.toolCalls.length, 1)
  assert.equal(parsed.toolCalls[0].error, true)
  assert.equal(parsed.errors.length, 1)
  assert.equal(parsed.stageFailures["S0"], 1)
})

test("parseStream pairs results FIFO for repeated same-name calls", () => {
  const events = [
    toolCall("c1_connector_authoring_get_run"),
    toolCall("c1_connector_authoring_get_run"),
    toolResult("c1_connector_authoring_get_run", "RUN_STATE_RUNNING"),
    toolResult("c1_connector_authoring_get_run", "RUN_STATE_SUCCEEDED"),
  ]
  const parsed = parseStream(events)
  assert.equal(parsed.toolCalls.length, 2)
  assert.equal(parsed.toolCalls[0].result, "RUN_STATE_RUNNING")
  assert.equal(parsed.toolCalls[1].result, "RUN_STATE_SUCCEEDED")
})

test("stage attempts count stage-entry cycles, not raw calls", () => {
  const events = [
    toolCall("c1_connector_authoring_get_run"),
    toolResult("c1_connector_authoring_get_run", "RUN_STATE_RUNNING"),
    toolCall("c1_connector_authoring_get_run"),
    toolResult("c1_connector_authoring_get_run", "RUN_STATE_SUCCEEDED"),
    toolCall("c1_connector_authoring_deploy_connector_instance"),
    toolResult("c1_connector_authoring_deploy_connector_instance", "dep"),
    toolCall("c1_connector_authoring_mint_approval_token"),
    toolResult("c1_connector_authoring_mint_approval_token", "token"),
  ]
  const parsed = parseStream(events)
  // Two consecutive get_run polls = one S5 entry; deploy+mint = one S11 entry.
  assert.equal(parsed.stageAttempts["S5"], 1)
  assert.equal(parsed.stageAttempts["S11"], 1)
})

test("recovery cycles count a successful re-entry after a stage failure", () => {
  const events = [
    toolCall("c1_connector_authoring_build_bundle"),
    toolResult("c1_connector_authoring_build_bundle", "failed", true),
    toolCall("c1_connector_authoring_build_bundle"),
    toolResult("c1_connector_authoring_build_bundle", "run-1"),
  ]
  const parsed = parseStream(events)
  assert.equal(parsed.recoveryCycles, 1)
  assert.equal(parsed.stageFailures["S4"], 1)
  // A failure ends the entry cycle: the retry is a NEW attempt.
  assert.equal(parsed.stageAttempts["S4"], 2)
})

test("turns counts text/user events and is at least 1", () => {
  const parsed = parseStream([{type: "text", message: "hi"}, {type: "user", message: "go"}])
  assert.equal(parsed.turns, 2)
  assert.equal(parseStream([]).turns, 1)
})

test("turns dedupes consecutive text_delta chunks into one turn", () => {
  const parsed = parseStream([
    {type: "text_delta", message: "hel"},
    {type: "text_delta", message: "lo"},
    {type: "tool_call", message: "bash", data: {input: {}}},
    {type: "tool_result", message: "out", data: {tool_name: "bash"}},
    {type: "text_delta", message: "done"},
  ])
  assert.equal(parsed.turns, 2)
})

test("usage events sum tokens", () => {
  const parsed = parseStream([
    {type: "usage", data: {tokens_in: 10, tokens_out: 5}},
    {type: "usage", data: {tokens_in: 20, tokens_out: 7}},
  ])
  assert.equal(parsed.tokensIn, 30)
  assert.equal(parsed.tokensOut, 12)
})

test("unknown event shapes are skipped, never thrown", () => {
  const parsed = parseStream([null, 42, "x", {type: "mystery", data: {weird: true}}])
  assert.equal(parsed.toolCalls.length, 0)
  assert.equal(parsed.errors.length, 0)
})
