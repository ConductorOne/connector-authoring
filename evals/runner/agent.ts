// agent.ts — agent prompt builder + task lifecycle (CXF-216 PR 1, C1).
// The 12-step funnel section is the LOCKED CONTRACT (transcribed verbatim);
// the c1 lifecycle doc is the reference for verifying its fidelity.
import {getTask, listModels, taskCreate, type CallOpts} from "./squire.ts"
import type {Scenario} from "./scenario.ts"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function isTerminal(state: unknown): boolean {
  return state === "completed" || state === "failed" || state === "canceled"
}

function skillBundleSection(scenario: Scenario): string {
  if (scenario.skillBundle.mode === "none") {
    return "No skill bundle. Follow the authoring guide returned by get_authoring_guide."
  }
  if (scenario.skillBundle.mode === "guide-only") {
    return "No skill bundle. Follow the authoring guide returned by get_authoring_guide; the guide is your only reference."
  }
  // full: inline the contents of evals/skills-bundle/ (placeholder this PR)
  return `Skill bundle (version ${scenario.skillBundle.version}) is mounted at evals/skills-bundle/ in the connector-authoring checkout. Read its README and follow any skill instructions there.`
}

export function buildPrompt(scenario: Scenario, runId: string, baseUrl: string, ref: string): string {
  const handoffPath = scenario.handoffPath.replace("<run-id>", runId)
  const creds = scenario.fixture.basicAuth
  return `You are an eval agent implementing a read-only Directory API connector and completing the 12-step in-app authoring funnel. Your goal: implement the connector source files, walk the funnel to the human-activation boundary, and stop there.

(1) ROLE + GOAL
Implement a read-only Directory API connector (users, groups, group memberships) and complete the 12-step authoring funnel deterministically. Stop at the human-activation boundary: after deploy + mint, write the handoff table and STOP. Never redeem the approval token, never poll for REVISION_STATUS_ACTIVE, never call c1_connector_service_force_sync.

(2) PROVIDER BRIEF
- Fixture base-url: ${baseUrl}
- Auth variant: basic — username ${creds.username}, password ${creds.password}
- OpenAPI document: ${baseUrl}${scenario.fixture.openapiPath}
- Use the /v1 surface (basic auth + offset pagination, page object {items, offset, limit, total}).
- The account_id scoping param is REQUIRED on GET /v1/users: the runtime GET descriptor accepts a query field, e.g. directory.GET({path: "/v1/users", query: {account_id: "acct-1"}, pagination: offsetPagination}). If you omit account_id, the API returns only a 3-user unscoped subset and the sync under-syncs to 3 users.
- user.title is nullable (null for some users) — project it into the profile without assuming non-null.
- Grant/revoke endpoints exist (POST/DELETE /v1/groups/{groupId}/members) but this eval scores sync only; no grant/revoke implementation is required.
- The connector source is checked out at the git ref ${ref} in this environment.

(3) CREDENTIALS TO SET IN STEP 8
- base-url: ${baseUrl}
- account-email: ${creds.username}
- api-token: ${creds.password}

(4) THE 12-STEP FUNNEL (follow exactly; record every ID in the handoff table as you go)
Step 0: Call c1_connector_authoring_get_authoring_guide (no args) and read the returned contract. Stop if it errors.
Step 1: Call c1_connector_authoring_create_draft {connectorName, displayName}. Extract catalog_id (draft.catalogId) and draft_id (draft.id). Stop if either is empty.
Step 2: Get the byte lengths (wc -c on each file), then call c1_connector_authoring_create_draft_source_upload {catalogId, draftId, files: [{path, sizeBytes}]} with the four files (connector.ts, config-schema.json, runtime-schema.json, capabilities.json) and their sizes. Extract upload_id. PUT each file's raw bytes to its presigned URL with the returned headers verbatim, using EXACTLY this curl form: curl -sS -o /tmp/put.out -w "%{http_code}" -X PUT "<url from the response>" -H "<required header from the response>" --data-binary @"<source-dir>/<path>". Stop if any PUT is not 200.
Step 3: Call c1_connector_authoring_finalize_draft_source_upload (same catalogId/draftId/upload_id/files), then c1_connector_authoring_get_draft {catalogId, draftId}. Stop if any of connector.ts/config-schema.json/runtime-schema.json/capabilities.json is marked missing.
Step 4: Call c1_connector_authoring_build_bundle {catalogId, draftId}. Extract run_id. Stop if empty.
Step 5: Poll c1_connector_authoring_get_run {runId} until RUN_STATE_SUCCEEDED. Extract revision_id. Stop on failure (fix source, re-run from step 2).
Step 6: Call c1_apps_create {displayName, description}. Extract app_id. Stop if empty.
Step 7: Call c1_connector_authoring_provision_connector {catalogId, appId}. Extract connector_id. Stop if empty.
Step 8: Call c1_connector_service_get {appId, id} then c1_connector_service_update {connector: {appId, id, catalogId, displayName, config: {"@type": "type.googleapis.com/c1.api.app.v1.EnvConfig", configuration: {"base-url": {stringValue}, "account-email": {stringValue}, "api-token": {stringValue}}}}, updateMask: "config"}. Stop if credentials missing.
Step 9: Call c1_connector_authoring_run_draft_test_sync {catalogId, revisionId, draftId, instanceAppId: <app_id from step 6>, instanceConnectorId: <connector_id from step 7>}. Extract test_run_id. Stop if empty.
Step 10: Poll c1_connector_authoring_get_test_run_evidence {catalogId, revisionId, testRunId} until the evidence row is present. Stop if FAIL (fix source, re-run from step 2 with a FRESH test_run_id); only PASS proceeds.
Step 11a: Call c1_connector_authoring_deploy_connector_instance {instanceAppId: <app_id from step 6>, instanceConnectorId: <connector_id from step 7>}. Extract deployment_instance_id. Stop if empty.
Step 11b: Call c1_connector_authoring_mint_approval_token {catalogId, revisionId, expiresInSeconds: "3600"}. Extract activation_url; then write the handoff table and STOP (the step-11 override below).

STEP-11 OVERRIDE (verbatim): The authoring guide's step 11 describes activation: give the activation_url to a human OWNER, wait for approval, poll c1_connector_authoring_list_revision_summaries until REVISION_STATUS_ACTIVE, then call c1_connector_service_force_sync. IN THIS EVAL you stop at 11b: after c1_connector_authoring_deploy_connector_instance and c1_connector_authoring_mint_approval_token, write the handoff table and STOP. Do NOT wait for approval, do NOT poll REVISION_STATUS_ACTIVE, do NOT call c1_connector_service_force_sync.

(5) SKILL BUNDLE
${skillBundleSection(scenario)}

(6) HARD STOP RULE + HANDOFF CONTRACT
After c1_connector_authoring_deploy_connector_instance (record deployment_instance_id) and c1_connector_authoring_mint_approval_token (record activation_url), write the handoff table to the arena FS at ${handoffPath} via squire.fs.write and STOP. The handoff table is a JSON object with ALL 10 fields: catalog_id, draft_id, upload_id, run_id, revision_id, app_id, connector_id, test_run_id, deployment_instance_id, activation_url. Write it with:
squire-tool call squire.fs.write '{"path": "${handoffPath}", "content": "<the full handoff JSON>"}'
Then STOP. Never redeem the approval token, never poll REVISION_STATUS_ACTIVE, never call c1_connector_service_force_sync.`
}

export async function createAgentTask(
  envId: string,
  scenario: Scenario,
  runId: string,
  prompt: string,
  opts: CallOpts = {},
): Promise<{taskId: string}> {
  const models = (await listModels(opts)) as Record<string, unknown>
  const modelList = (models.models ?? []) as Record<string, unknown>[]
  const present = modelList.some((m) => m.id === scenario.model)
  if (!present) {
    throw new Error(
      `model ${scenario.model} not present in squire.list_models — cannot run the eval (available: ${modelList.map((m) => String(m.id)).join(", ")})`,
    )
  }
  const res = (await taskCreate(
    {
      env_id: envId,
      prompt,
      model: scenario.model,
      title: `eval-agent-${runId}`,
    },
    opts,
  )) as Record<string, unknown>
  const taskId = res.id as string
  if (!taskId) throw new Error(`agent task create returned no id: ${JSON.stringify(res)}`)
  return {taskId}
}

export async function waitForAgentTask(
  envId: string,
  taskId: string,
  timeoutMs: number,
  opts: CallOpts = {},
): Promise<{terminal: boolean; wallTimeMs: number; timedOut: boolean}> {
  const startedAt = Date.now()
  const deadline = startedAt + timeoutMs
  while (Date.now() < deadline) {
    const res = await getTask(envId, taskId, opts)
    const state = (res.task as Record<string, unknown> | undefined)?.state as string | undefined
    if (state && isTerminal(state)) {
      return {terminal: true, wallTimeMs: Date.now() - startedAt, timedOut: false}
    }
    await sleep(10_000)
  }
  return {terminal: false, wallTimeMs: Date.now() - startedAt, timedOut: true}
}
