// score.test.ts — unit smoke for the deterministic scorer (locked D3/L24/L35).
// A synthetic clean-run transcript must score first_pass_rate 1.0; stalled
// and failed runs must score FAIL safely.
import {test} from "node:test"
import assert from "node:assert/strict"
import {scoreRun} from "./score.ts"
import {STAGES, type Handoff, type StageCtx} from "./stages.ts"
import {parseStream, type ParsedStream} from "./stream.ts"
import type {ScoreInput} from "./stages.ts"

const HANDOFF_PATH = "/current-tasks/evals/evals-tier1-directory-20260902-120000-000/handoff.json"

function fullHandoff(): Handoff {
  return {
    catalog_id: "cat-1",
    draft_id: "draft-1",
    upload_id: "up-1",
    run_id: "run-1",
    revision_id: "rev-1",
    app_id: "app-1",
    connector_id: "conn-1",
    test_run_id: "test-1",
    deployment_instance_id: "dep-1",
    activation_url: "https://activate/1",
  }
}

function toolCall(name: string, input?: Record<string, unknown>): Record<string, unknown> {
  return {type: "tool_call", message: name, data: {input: input ?? {}}}
}

function toolResult(name: string, message: string, isError = false): Record<string, unknown> {
  return {type: "tool_result", message, data: {tool_name: name, is_error: isError}}
}

/** A clean funnel event stream: every stage entered once, all confirmed. */
function cleanEvents(): Record<string, unknown>[] {
  return [
    toolCall("c1_connector_authoring_get_authoring_guide"),
    toolResult("c1_connector_authoring_get_authoring_guide", "guide"),
    toolCall("c1_connector_authoring_create_draft", {connectorName: "x"}),
    toolResult("c1_connector_authoring_create_draft", "draft"),
    toolCall("c1_connector_authoring_create_draft_source_upload"),
    toolResult("c1_connector_authoring_create_draft_source_upload", "upload"),
    toolCall("bash", {i: "put", command: 'curl -X PUT "http://x" -w "%{http_code}"'}),
    toolResult("bash", "200"),
    toolCall("c1_connector_authoring_finalize_draft_source_upload"),
    toolResult("c1_connector_authoring_finalize_draft_source_upload", "finalized"),
    toolCall("c1_connector_authoring_get_draft"),
    toolResult("c1_connector_authoring_get_draft", "draft"),
    toolCall("c1_connector_authoring_build_bundle"),
    toolResult("c1_connector_authoring_build_bundle", "run"),
    toolCall("c1_connector_authoring_get_run"),
    toolResult("c1_connector_authoring_get_run", "RUN_STATE_RUNNING"),
    toolCall("c1_connector_authoring_get_run"),
    toolResult("c1_connector_authoring_get_run", "RUN_STATE_SUCCEEDED"),
    toolCall("c1_apps_create"),
    toolResult("c1_apps_create", "app"),
    toolCall("c1_connector_authoring_provision_connector"),
    toolResult("c1_connector_authoring_provision_connector", "conn"),
    toolCall("c1_connector_service_update"),
    toolResult("c1_connector_service_update", "updated"),
    toolCall("c1_connector_authoring_run_draft_test_sync"),
    toolResult("c1_connector_authoring_run_draft_test_sync", "test"),
    toolCall("c1_connector_authoring_get_test_run_evidence"),
    toolResult("c1_connector_authoring_get_test_run_evidence", "PENDING"),
    toolCall("c1_connector_authoring_get_test_run_evidence"),
    toolResult("c1_connector_authoring_get_test_run_evidence", "PASS"),
    toolCall("c1_connector_authoring_deploy_connector_instance"),
    toolResult("c1_connector_authoring_deploy_connector_instance", "dep"),
    toolCall("c1_connector_authoring_mint_approval_token"),
    toolResult("c1_connector_authoring_mint_approval_token", "token"),
    toolCall("bash", {i: "handoff", command: `squire-tool call squire.fs.write '{"path": "${HANDOFF_PATH}"}'`}),
    toolResult("bash", "written"),
    toolCall("bash", {i: "complete", command: `squire-tool call squire.task.complete '{"summary": "handoff written"}'`}),
    toolResult("bash", "done"),
  ]
}

function cleanTranscript(): ParsedStream {
  return parseStream(cleanEvents())
}

function goodScoreInput(): ScoreInput {
  return {
    run_id: "run-1",
    draft: {
      required_source_files: {
        "connector.ts": true,
        "config-schema.json": true,
        "runtime-schema.json": true,
        "capabilities.json": true,
      },
      source_files: [
        {
          path: "connector.ts",
          content:
            'directory.GET({path: "/v1/users", query: {account_id: "acct-1"}, pagination: offsetPagination}) user.title totalPath config("base-url") config("account-email") config("api-token") newUserResource user.id',
        },
      ],
      config_schema: {
        fields: [
          {name: "base-url", is_secret: false},
          {name: "account-email", is_secret: false},
          {name: "api-token", is_secret: true},
        ],
      },
      runtime_schema: {
        fields: [
          {name: "base-url", is_secret: false},
          {name: "account-email", is_secret: false},
          {name: "api-token", is_secret: true},
        ],
      },
    },
    connector_config: {"base-url": "http://127.0.0.1:18080", "account-email": "connector@example.com", "api-token": "fixture-token"},
    evidence: {result: "PASS"},
    build_run: {state: "RUN_STATE_SUCCEEDED"},
    tenant_counts: {users: 0, groups: 0, memberships: 0},
    resource_ids: {users: [], groups: []},
  }
}

function ctx(overrides: Partial<StageCtx>): StageCtx {
  return {
    transcript: cleanTranscript(),
    handoff: fullHandoff(),
    scoreInput: goodScoreInput(),
    handoffPath: HANDOFF_PATH,
    ...overrides,
  }
}

test("a clean run scores first_pass_rate 1.0 with every stage passing", () => {
  const result = scoreRun(ctx({}))
  assert.equal(result.stageRows.length, STAGES.length)
  assert.ok(result.stageRows.every((row) => row.pass === true), JSON.stringify(result.stageRows))
  assert.ok(result.stageRows.every((row) => row.first_pass === true), JSON.stringify(result.stageRows))
  assert.equal(result.first_pass_rate, 1.0)
  assert.equal(result.recovery_cycles, 0)
  assert.equal(result.parity_verdict, "PASS")
  assert.equal(result.hygiene_verdict, "PASS")
  assert.equal(result.handoff_discipline_verdict, true)
  assert.deepEqual(result.funnel, ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11"])
})

test("a completely absent handoff fails S1-S10 with the locked stalled evidence", () => {
  const result = scoreRun(ctx({handoff: {}}))
  for (const row of result.stageRows) {
    if (row.stage === "S0" || row.stage === "S11") continue
    assert.equal(row.pass, false)
    assert.equal(row.evidence, "handoff incomplete - agent stalled")
  }
})

test("a partial handoff scores genuinely-reached stages from their own evidence", () => {
  const h = fullHandoff()
  h.activation_url = "" // only the final field missing
  const result = scoreRun(ctx({handoff: h}))
  const byStage = new Map(result.stageRows.map((r) => [r.stage, r]))
  // S1..S10 are satisfied by the present handoff fields + transcript/score-input.
  for (const s of ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10"]) {
    assert.equal(byStage.get(s)?.pass, true, `${s} should pass on a partial handoff`)
  }
  assert.equal(byStage.get("S11")?.pass, false)
})

test("a failed build fails S5 and downstream parity/hygiene still compute", () => {
  const failed = ctx({scoreInput: {...goodScoreInput(), build_run: {state: "RUN_STATE_FAILED"}}})
  const result = scoreRun(failed)
  const s5 = result.stageRows.find((row) => row.stage === "S5")
  assert.equal(s5?.pass, false)
  assert.equal(result.parity_verdict, "PASS") // static check independent of build
})

test("parity fails when account_id is not inside a query object", () => {
  const leaky = goodScoreInput()
  leaky.draft.source_files = [
    {path: "connector.ts", content: '// account_id is required\nuser.title totalPath config("base-url") config("account-email") config("api-token") newUserResource user.id'},
  ]
  const result = scoreRun(ctx({scoreInput: leaky}))
  assert.equal(result.parity_verdict, "FAIL")
})

test("parity fails when account_id appears only in a commented-out GET example", () => {
  const leaky = goodScoreInput()
  leaky.draft.source_files = [
    {path: "connector.ts", content: '// directory.GET({path: "/v1/users", query: {account_id: "acct-1"}})\nuser.title totalPath config("base-url") config("account-email") config("api-token") newUserResource user.id'},
  ]
  const result = scoreRun(ctx({scoreInput: leaky}))
  assert.equal(result.parity_verdict, "FAIL")
})

test("parity passes when account_id sits inside a query object", () => {
  const good = goodScoreInput()
  good.draft.source_files = [
    {path: "connector.ts", content: 'directory.GET({path: "/v1/users", query: {account_id: "acct-1"}}) user.title totalPath config("base-url") config("account-email") config("api-token") newUserResource user.id'},
  ]
  const result = scoreRun(ctx({scoreInput: good}))
  assert.equal(result.parity_verdict, "PASS")
})

test("hygiene fails on a plaintext fixture-token in uploaded source", () => {
  const leaky = goodScoreInput()
  leaky.draft.source_files = [{path: "connector.ts", content: "const t = 'fixture-token'"}]
  const result = scoreRun(ctx({scoreInput: leaky}))
  assert.equal(result.hygiene_verdict, "FAIL")
})

test("parity fails when the connector source is unavailable", () => {
  const noSource = goodScoreInput()
  noSource.draft.source_files = []
  const result = scoreRun(ctx({scoreInput: noSource}))
  assert.equal(result.parity_verdict, "FAIL")
})
