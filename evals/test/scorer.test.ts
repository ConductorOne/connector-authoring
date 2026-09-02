/**
 * Deterministic scorer tests: synthetic transcripts + collections through
 * scoreRun, asserting the stage funnel, recovery classification, synced-data
 * traps, and handoff discipline.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreRun } from "../src/scorer/index.ts";
import { normalizeTranscript, type NormalizedTranscript, type TranscriptCall } from "../src/transcript.ts";
import {
  call,
  happyCollection,
  happyHandoff,
  happyTranscript,
  resetSeq,
  TEST_SCENARIO,
  TEST_SECRETS,
} from "./helpers.ts";

const asTranscript = (calls: TranscriptCall[]): NormalizedTranscript => ({
  calls,
  assistantText: "",
  turns: null,
  tokensIn: null,
  tokensOut: null,
});

const GOOD_SOURCE: Record<string, string> = {
  "connector.ts": `import { config, connector, http, node, slot, walk, resourceType } from "@baton/runtime"
import { newUserResource } from "@baton/types"
const baseUrl = config("base-url")
const apiToken = config("api-token")
const directory = http.v1({ baseUrl, auth: { type: "basic", username: config("account-email"), password: apiToken } })
const userRow = slot()
const listUsers = node({ outputs: { userRow }, run: () => directory.GET({ path: "/v1/users" }), result: ({ response }) => [] })
const users = walk({ nodes: [listUsers], from: { userRow }, to: ({ userRow }) => newUserResource("n", "user", "id") })
const userType = resourceType({ id: "user", displayName: "User", traits: ["TRAIT_USER"], resources: users })
export default connector({ metadata: { displayName: "x" }, transports: { directory }, resourceTypes: [userType] })
`,
  "config-schema.json": JSON.stringify({
    fields: [
      { name: "base-url", stringField: { rules: { isRequired: true } } },
      { name: "account-email", stringField: { rules: { isRequired: true } } },
      { name: "api-token", isSecret: true, stringField: { rules: { isRequired: true } } },
    ],
  }),
  "runtime-schema.json": JSON.stringify({
    version: 1,
    name: "directory-fixture",
    runtime: {
      connector: "connector.js",
      config_schema: {
        fields: [
          { name: "base-url", type: "string", required: true },
          { name: "account-email", type: "string", required: true },
          { name: "api-token", type: "string", required: true, is_secret: true },
        ],
      },
    },
  }),
  "capabilities.json": JSON.stringify({ sync: true, grant: false, revoke: false }),
};

function scoreHappy() {
  return scoreRun({
    scenario: TEST_SCENARIO,
    transcript: asTranscript(happyTranscript()),
    collection: happyCollection(),
    sourceFiles: GOOD_SOURCE,
    handoff: happyHandoff(),
    secretValues: TEST_SECRETS,
  });
}

describe("scoreRun — happy path", () => {
  const score = scoreHappy();

  it("passes every stage through S11b", () => {
    for (const id of ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11a", "S11b"] as const) {
      assert.equal(score.stages[id].status, "pass", `${id} should pass`);
    }
  });

  it("marks S11c/S11d as human_boundary when activation has not happened", () => {
    assert.equal(score.stages.S11c.status, "human_boundary");
    assert.equal(score.stages.S11d.status, "human_boundary");
  });

  it("is agent-complete but not a full pass", () => {
    assert.equal(score.funnel.agentComplete, true);
    assert.equal(score.funnel.fullPass, false);
    assert.equal(score.funnel.reached, "S11c");
  });

  it("has a perfect first-pass rate and no recovery events", () => {
    assert.equal(score.metrics.firstPassRate, 1);
    assert.equal(score.recovery.cycles, 0);
    assert.equal(score.recovery.events.length, 0);
  });

  it("scores synced-data parity and trap avoidance", () => {
    assert.equal(score.syncedData.available, true);
    assert.equal(score.syncedData.parity.users.ok, true);
    assert.equal(score.syncedData.parity.grants.ok, true);
    assert.equal(score.syncedData.traps.domainScoping, "avoided");
    assert.equal(score.syncedData.traps.nullableEmail, "avoided");
    assert.equal(score.syncedData.traps.pendingMemberGrants, "avoided");
    assert.equal(score.syncedData.plaintextSecretFound, false);
  });

  it("passes source hygiene and handoff discipline", () => {
    assert.equal(score.sourceHygiene.requiredFilesPresent, true);
    assert.equal(score.sourceHygiene.dualSchemaParity, true);
    assert.equal(score.sourceHygiene.isSecretOk, true);
    assert.deepEqual(score.sourceHygiene.violations, []);
    assert.equal(score.handoff.tableComplete, true);
    assert.equal(score.handoff.stoppedAtHumanBoundary, true);
  });
});

describe("scoreRun — full pass when a human activated", () => {
  it("S11c/S11d pass with ACTIVE revision + SYNC_STATUS_DONE", () => {
    resetSeq();
    const calls = [
      // The human OWNER activated; the agent observes ACTIVE, then syncs.
      ...happyTranscript().map((c) =>
        c.tool === "c1_connector_authoring_list_revision_summaries"
          ? call("c1_connector_authoring_list_revision_summaries", {
              args: { catalogId: "cat1", pageSize: 100 },
              result: '{"revisions":[{"revisionId":"rev1","status":"REVISION_STATUS_ACTIVE","activationEpoch":"3"}]}',
            })
          : c,
      ),
      call("c1_connector_service_force_sync", { args: { appId: "app1", connectorId: "conn1" }, result: "{}" }),
      call("c1_connector_service_get", {
        args: { appId: "app1", id: "conn1" },
        result: '{"connectorView":{"connector":{"status":{"status":"SYNC_STATUS_DONE"}}}}',
      }),
    ];
    const score = scoreRun({
      scenario: TEST_SCENARIO,
      transcript: asTranscript(calls),
      collection: happyCollection({
        connector: { status: "SYNC_STATUS_DONE", lastError: null },
        revisions: [{ revisionId: "rev1", status: "REVISION_STATUS_ACTIVE", activationEpoch: "3" }],
      }),
      sourceFiles: GOOD_SOURCE,
      handoff: { ...happyHandoff(), activation_epoch: "3" },
      secretValues: TEST_SECRETS,
    });
    assert.equal(score.stages.S11c.status, "pass");
    assert.equal(score.stages.S11d.status, "pass");
    assert.equal(score.funnel.fullPass, true);
  });
});

describe("scoreRun — build failure then correct recovery", () => {
  resetSeq();
  const calls = [...happyTranscript()];
  // Replace the single successful build with fail → re-upload → rebuild → success.
  const buildIdx = calls.findIndex((c) => c.tool === "c1_connector_authoring_build_bundle");
  const recovered = [
    ...calls.slice(0, buildIdx + 1),
    call("c1_connector_authoring_get_run", {
      args: { runId: "run1" },
      result: '{"state":"RUN_STATE_FAILED","error":"compile error"}',
    }),
    call("c1_connector_authoring_update_draft_source", { args: { catalogId: "cat1", draftId: "dr1" }, result: "{}" }),
    call("c1_connector_authoring_build_bundle", {
      args: { catalogId: "cat1", draftId: "dr1" },
      result: '{"runId":"run2"}',
    }),
    ...calls.slice(buildIdx + 1).map((c) =>
      c.tool === "c1_connector_authoring_get_run"
        ? call("c1_connector_authoring_get_run", {
            args: { runId: "run2" },
            result: '{"state":"RUN_STATE_SUCCEEDED","result":{"resultRef":"rev1"}}',
          })
        : c,
    ),
  ];
  const score = scoreRun({
    scenario: TEST_SCENARIO,
    transcript: asTranscript(recovered),
    collection: happyCollection(),
    sourceFiles: GOOD_SOURCE,
    handoff: happyHandoff(),
    secretValues: TEST_SECRETS,
  });

  it("S5 passes but not first-pass", () => {
    assert.equal(score.stages.S5.status, "pass");
    assert.equal(score.stages.S5.firstPass, false);
  });

  it("records one correct fix-and-rerun cycle", () => {
    assert.equal(score.recovery.cycles, 1);
    assert.equal(score.recovery.correctStepReruns, 1);
    assert.equal(score.recovery.incorrectStepReruns, 0);
    assert.equal(score.recovery.events[0].kind, "fix_and_rerun");
  });
});

describe("scoreRun — rebuild without a source fix is an incorrect re-run", () => {
  resetSeq();
  const calls = [...happyTranscript()];
  const buildIdx = calls.findIndex((c) => c.tool === "c1_connector_authoring_build_bundle");
  const rerun = [
    ...calls.slice(0, buildIdx + 1),
    call("c1_connector_authoring_get_run", { args: { runId: "run1" }, result: '{"state":"RUN_STATE_FAILED"}' }),
    call("c1_connector_authoring_build_bundle", { args: { catalogId: "cat1", draftId: "dr1" }, result: '{"runId":"run2"}' }),
    ...calls.slice(buildIdx + 1).map((c) =>
      c.tool === "c1_connector_authoring_get_run"
        ? call("c1_connector_authoring_get_run", { args: { runId: "run2" }, result: '{"state":"RUN_STATE_SUCCEEDED","result":{"resultRef":"rev1"}}' })
        : c,
    ),
  ];
  const score = scoreRun({
    scenario: TEST_SCENARIO,
    transcript: asTranscript(rerun),
    collection: happyCollection(),
    sourceFiles: GOOD_SOURCE,
    handoff: happyHandoff(),
    secretValues: TEST_SECRETS,
  });

  it("flags rerun_without_fix", () => {
    assert.equal(score.recovery.incorrectStepReruns, 1);
    assert.equal(score.recovery.events[0].kind, "rerun_without_fix");
  });
});

describe("scoreRun — FAIL evidence then token re-mint without retest", () => {
  resetSeq();
  const calls = [...happyTranscript()];
  const evidenceIdx = calls.findIndex((c) => c.tool === "c1_connector_authoring_get_test_run_evidence");
  const withFail = [
    ...calls.slice(0, evidenceIdx),
    call("c1_connector_authoring_get_test_run_evidence", {
      args: { catalogId: "cat1", revisionId: "rev1", testRunId: "tr1" },
      result: '{"result":"TEST_RUN_RESULT_FAIL","error":"Invalid token provided"}',
    }),
    ...calls.slice(evidenceIdx + 1),
  ];
  const score = scoreRun({
    scenario: TEST_SCENARIO,
    transcript: asTranscript(withFail),
    collection: happyCollection(),
    sourceFiles: GOOD_SOURCE,
    handoff: happyHandoff(),
    secretValues: TEST_SECRETS,
  });

  it("S10 fails (no PASS row)", () => {
    assert.equal(score.stages.S10.status, "fail");
  });

  it("flags the token re-mint as incorrect recovery", () => {
    const remint = score.recovery.events.find((e) => e.kind === "token_remint_without_retest");
    assert.ok(remint, "expected a token_remint_without_retest event");
    assert.equal(remint.correct, false);
  });

  it("agent is not complete", () => {
    assert.equal(score.funnel.agentComplete, false);
  });
});

describe("scoreRun — empty secret on configure", () => {
  resetSeq();
  const calls = happyTranscript().map((c) =>
    c.tool === "c1_connector_service_update"
      ? call("c1_connector_service_update", {
          args: {
            connector: { appId: "app1", id: "conn1", config: { configuration: { "api-token": { stringValue: "" } } } },
            updateMask: "config",
          },
          result: '{"connector":{"id":"conn1"}}',
        })
      : c,
  );
  const score = scoreRun({
    scenario: TEST_SCENARIO,
    transcript: asTranscript(calls),
    collection: happyCollection(),
    sourceFiles: GOOD_SOURCE,
    handoff: happyHandoff(),
    secretValues: TEST_SECRETS,
  });

  it("S8 fails with the empty-secret explanation", () => {
    assert.equal(score.stages.S8.status, "fail");
    assert.ok(score.stages.S8.failures.some((f) => f.includes("empty stringValue")));
  });
});

describe("scoreRun — handoff violations", () => {
  it("force sync before ACTIVE fails S11d and handoff discipline", () => {
    resetSeq();
    const calls = [
      ...happyTranscript(),
      call("c1_connector_service_force_sync", { args: { appId: "app1", connectorId: "conn1" }, result: "{}" }),
    ];
    const score = scoreRun({
      scenario: TEST_SCENARIO,
      transcript: asTranscript(calls),
      collection: happyCollection(),
      sourceFiles: GOOD_SOURCE,
      handoff: happyHandoff(),
      secretValues: TEST_SECRETS,
    });
    assert.equal(score.stages.S11d.status, "fail");
    assert.equal(score.handoff.stoppedAtHumanBoundary, false);
    assert.equal(score.funnel.agentComplete, false);
  });

  it("missing handoff table fails tableComplete", () => {
    const score = scoreRun({
      scenario: TEST_SCENARIO,
      transcript: asTranscript(happyTranscript()),
      collection: happyCollection(),
      sourceFiles: GOOD_SOURCE,
      handoff: null,
      secretValues: TEST_SECRETS,
    });
    assert.equal(score.handoff.tableComplete, false);
    assert.ok(score.handoff.violations.some((v) => v.includes("handoff.json missing")));
  });
});

describe("scoreRun — synced-data traps", () => {
  it("corp-only count flags the domain-scoping trap", () => {
    const score = scoreRun({
      scenario: TEST_SCENARIO,
      transcript: asTranscript(happyTranscript()),
      collection: happyCollection({ counts: { users: 218, groups: 12, roles: 8, entitlements: 12, grants: 336 } }),
      sourceFiles: GOOD_SOURCE,
      handoff: happyHandoff(),
      secretValues: TEST_SECRETS,
    });
    assert.equal(score.syncedData.traps.domainScoping, "triggered");
    assert.equal(score.syncedData.parity.users.ok, false);
  });

  it("grants on pending rows flag the pending-member trap", () => {
    const score = scoreRun({
      scenario: TEST_SCENARIO,
      transcript: asTranscript(happyTranscript()),
      collection: happyCollection({ pendingRowGrants: ["grant-x"] }),
      sourceFiles: GOOD_SOURCE,
      handoff: happyHandoff(),
      secretValues: TEST_SECRETS,
    });
    assert.equal(score.syncedData.traps.pendingMemberGrants, "triggered");
  });

  it("unresolved grant wiring fails the wiring check", () => {
    const score = scoreRun({
      scenario: TEST_SCENARIO,
      transcript: asTranscript(happyTranscript()),
      collection: happyCollection({ grantWiring: { checked: 336, unresolvedPrincipal: 2, unresolvedEntitlement: 0 } }),
      sourceFiles: GOOD_SOURCE,
      handoff: happyHandoff(),
      secretValues: TEST_SECRETS,
    });
    assert.equal(score.syncedData.grantWiringOk, false);
  });

  it("a plaintext credential in connector.ts is caught", () => {
    const score = scoreRun({
      scenario: TEST_SCENARIO,
      transcript: asTranscript(happyTranscript()),
      collection: happyCollection(),
      sourceFiles: { ...GOOD_SOURCE, "connector.ts": GOOD_SOURCE["connector.ts"] + `\n// fx_tok_7c1f3a9d5e2b48f0a6c1d3e5f7a9b2c4\n` },
      handoff: happyHandoff(),
      secretValues: TEST_SECRETS,
    });
    assert.equal(score.syncedData.plaintextSecretFound, true);
    assert.equal(score.sourceHygiene.connectorContractOk, false);
  });
});

describe("scoreRun — tier 0 terminal stage", () => {
  it("marks stages past S5 not_applicable for a tier-0 scenario", () => {
    resetSeq();
    const tier0: typeof TEST_SCENARIO = {
      ...TEST_SCENARIO,
      id: "tier0-static",
      tier: 0,
      terminalStage: "S5",
      expectations: null,
    };
    const calls = happyTranscript().slice(0, 7); // through the successful get_run
    const score = scoreRun({
      scenario: tier0,
      transcript: asTranscript(calls),
      collection: null,
      sourceFiles: GOOD_SOURCE,
      handoff: null,
      secretValues: TEST_SECRETS,
    });
    assert.equal(score.stages.S5.status, "pass");
    assert.equal(score.stages.S6.status, "not_applicable");
    assert.equal(score.stages.S11d.status, "not_applicable");
  });
});

describe("normalizeTranscript integration", () => {
  it("round-trips a claude-style event stream into calls", () => {
    const events = [
      { type: "tool_call", id: "t1", tool: "mcp__c1dev__c1_apps_create", args: { displayName: "x" } },
      { type: "tool_result", tool_call_id: "t1", result: '{"app":{"id":"app1"}}' },
      { type: "text", text: "done" },
      { type: "usage", usage: { input_tokens: 10, output_tokens: 5 } },
    ];
    const t = normalizeTranscript(events);
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].tool, "c1_apps_create");
    assert.equal(t.calls[0].ok, true);
    assert.equal(t.tokensIn, 10);
    assert.equal(t.tokensOut, 5);
  });
});
