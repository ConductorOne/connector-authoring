/**
 * Shared builders for scorer tests: synthetic transcripts, scenarios,
 * collections, and handoff tables.
 */
import type { Collection, Scenario } from "../src/scorer/types.ts";
import type { TranscriptCall } from "../src/transcript.ts";

let seq = 0;

export function call(
  tool: string,
  opts: { args?: Record<string, unknown>; result?: string; ok?: boolean; error?: string | null } = {},
): TranscriptCall {
  const args = opts.args ?? {};
  return {
    seq: seq++,
    tool,
    rawTool: tool.startsWith("mcp__") ? tool : `mcp__c1dev__${tool}`,
    args,
    argsText: JSON.stringify(args),
    ok: opts.ok ?? true,
    errorText: opts.error ?? null,
    resultText: opts.result ?? "{}",
    ts: null,
  };
}

export function resetSeq(): void {
  seq = 0;
}

export const TEST_SCENARIO: Scenario = {
  id: "tier1-directory",
  tier: 1,
  description: "test scenario",
  provider: {
    name: "directory-fixture",
    displayName: "Directory API (eval fixture)",
    docsUrl: "http://fixture/openapi.json",
    auth: {
      scheme: "basic",
      fields: {
        "base-url": "http://fixture",
        "account-email": "connector@fixture.example",
        "api-token": "fx_tok_7c1f3a9d5e2b48f0a6c1d3e5f7a9b2c4",
      },
    },
    credentialFields: ["api-token"],
  },
  sourceDirName: "connector-src",
  terminalStage: "S11b",
  expectations: {
    users: { total: 230, byDomain: { corp: 218, partners: 12 }, nullEmail: ["u0007", "u0113"] },
    groups: 12,
    memberships: { active: 336, pending: 6, pendingRows: ["g01:u0005", "g02:u0055"] },
    roles: 8,
  },
};

export const TEST_SECRETS = ["fx_tok_7c1f3a9d5e2b48f0a6c1d3e5f7a9b2c4"];

export function happyHandoff(): Record<string, string> {
  return {
    catalog_id: "cat1",
    draft_id: "dr1",
    revision_id: "rev1",
    build_run_id: "run1",
    app_id: "app1",
    connector_id: "conn1",
    test_run_id: "tr1",
    deployment_instance_id: "dep1",
    activation_epoch: "",
  };
}

export function happyCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    connector: { status: "SYNC_STATUS_DISABLED", lastError: null },
    revisions: [],
    counts: { users: 230, groups: 12, roles: 8, entitlements: 12, grants: 336 },
    grantWiring: { checked: 336, unresolvedPrincipal: 0, unresolvedEntitlement: 0 },
    idStability: null,
    userSample: [
      { id: "u0007", hasLogin: true },
      { id: "u0113", hasLogin: true },
    ],
    pendingRowGrants: [],
    ...overrides,
  };
}

/** The canonical happy-path transcript: S0..S11b pass, clean human handoff. */
export function happyTranscript(): TranscriptCall[] {
  resetSeq();
  return [
    call("c1_connector_authoring_get_authoring_guide", { result: "# authoring guide" }),
    call("c1_connector_authoring_create_draft", {
      args: { connectorName: "directory-fixture", displayName: "Directory API (eval fixture)" },
      result: '{"catalogId":"cat1","draft":{"id":"dr1"}}',
    }),
    call("c1_connector_authoring_create_draft_source_upload", {
      args: { catalogId: "cat1", draftId: "dr1", files: [{ path: "connector.ts", sizeBytes: "100" }] },
      result: '{"uploadId":"up1","files":{"connector.ts":{"url":"https://s3/put"}}}',
    }),
    call("c1_connector_authoring_finalize_draft_source_upload", {
      args: { catalogId: "cat1", draftId: "dr1", uploadId: "up1" },
      result: "{}",
    }),
    call("c1_connector_authoring_get_draft", {
      args: { catalogId: "cat1", draftId: "dr1" },
      result:
        '{"requiredSourceFiles":[{"path":"connector.ts","present":true},{"path":"config-schema.json","present":true},{"path":"runtime-schema.json","present":true},{"path":"capabilities.json","present":true}]}',
    }),
    call("c1_connector_authoring_build_bundle", {
      args: { catalogId: "cat1", draftId: "dr1" },
      result: '{"runId":"run1"}',
    }),
    call("c1_connector_authoring_get_run", {
      args: { runId: "run1" },
      result: '{"state":"RUN_STATE_SUCCEEDED","result":{"resultRef":"rev1"}}',
    }),
    call("c1_apps_create", {
      args: { displayName: "Directory App" },
      result: '{"app":{"id":"app1"}}',
    }),
    call("c1_connector_authoring_provision_connector", {
      args: { catalogId: "cat1", appId: "app1" },
      result: '{"connectorId":"conn1","appId":"app1"}',
    }),
    call("c1_connector_service_get", {
      args: { appId: "app1", id: "conn1" },
      result: '{"connectorView":{"connector":{"id":"conn1"}}}',
    }),
    call("c1_connector_service_update", {
      args: {
        connector: {
          appId: "app1",
          id: "conn1",
          config: {
            "@type": "type.googleapis.com/c1.api.app.v1.EnvConfig",
            configuration: {
              "base-url": { stringValue: "http://fixture" },
              "account-email": { stringValue: "connector@fixture.example" },
              "api-token": { stringValue: "fx_tok_7c1f3a9d5e2b48f0a6c1d3e5f7a9b2c4" },
            },
          },
        },
        updateMask: "config",
      },
      result: '{"connector":{"id":"conn1"}}',
    }),
    call("c1_connector_authoring_run_draft_test_sync", {
      args: { catalogId: "cat1", revisionId: "rev1", draftId: "dr1" },
      result: '{"testRunId":"tr1","workflowRunId":"wf1"}',
    }),
    call("c1_connector_authoring_get_test_run_evidence", {
      args: { catalogId: "cat1", revisionId: "rev1", testRunId: "tr1" },
      result: '{"result":"TEST_RUN_RESULT_PASS"}',
    }),
    call("c1_connector_authoring_deploy_connector_instance", {
      args: { instanceAppId: "app1", instanceConnectorId: "conn1" },
      result: '{"deploymentInstanceId":"dep1"}',
    }),
    call("c1_connector_authoring_mint_approval_token", {
      args: { catalogId: "cat1", revisionId: "rev1", expiresInSeconds: "3600" },
      result: '{"activationUrl":"https://tenant.example/activate?token=tok1","tokenId":"tok1"}',
    }),
    call("c1_connector_authoring_list_revision_summaries", {
      args: { catalogId: "cat1", pageSize: 100 },
      result: '{"revisions":[{"revisionId":"rev1","status":"REVISION_STATUS_TEST_PASSED"}]}',
    }),
  ];
}
