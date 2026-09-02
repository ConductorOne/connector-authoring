// collect.ts — score collector task + score-input validation (CXF-216 PR 1, D1).
import {fsRead, getTask, taskCreate, type CallOpts} from "./squire.ts"
import type {Scenario} from "./scenario.ts"
import {isRecord} from "./scenario.ts"
import type {Handoff, ScoreInput} from "./stages.ts"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function isTerminal(state: unknown): boolean {
  return state === "completed" || state === "failed" || state === "canceled"
}

function scoreInputPath(runId: string): string {
  return `/current-tasks/evals/${runId}/score-input.json`
}

// The collector prompt is EXACTLY this (the handoff path is substituted; the
// VALUES are never interpolated — the collector reads the agent-written
// handoff.json from the arena FS itself, so an untrusted handoff cannot
// inject instructions into the collector prompt).
export function buildCollectorPrompt(
  scenario: Scenario,
  runId: string,
  handoffPath: string,
  handoff: Handoff,
): string {
  const missing = Object.values(handoff).every((v) => !v || v.length === 0)
  const missingNote = missing
    ? "\nThe agent handoff was incomplete; record null for every handoff-dependent field (draft, connector_config, evidence, build_run, revision_status, tenant_counts, resource_ids)."
    : ""
  return `You are the score collector for eval run ${runId}. Use \`squire-tool call\` for every step. First read the agent's handoff table from the arena FS at ${handoffPath} via \`squire.fs.read\` and parse its JSON — use the values from THAT file for every id below (do not invent ids). (a) \`c1_connector_authoring_get_draft\` with the handoff's \`catalog_id\` and \`draft_id\` → record \`required_source_files\` presence and the full source set. (b) \`c1_connector_service_get\` with the handoff's \`app_id\` and \`connector_id\` → record the connector config values for \`base-url\`, \`account-email\`, \`api-token\`. (c) \`c1_connector_authoring_get_test_run_evidence\` with the handoff's \`catalog_id\`, \`revision_id\`, \`test_run_id\` → record \`result\` (PASS/FAIL/NotFound) and error text. (d) \`c1_connector_authoring_list_revision_summaries\` with the handoff's \`catalog_id\` → record the target revision's status. (e) \`c1_connector_authoring_get_run\` with the handoff's \`run_id\` → record the build run state. (f) Tenant counts, LOCKED procedure: \`squire-tool list\` → filter names containing \`_search\`/\`_count\`/\`find_\`/\`count_\` → \`squire-tool describe <tool>\` for each candidate to learn its args → query resources/entitlements/grants scoped to the handoff's \`app_id\` and fetch resource ids, SPLITTING resources into users vs groups by the resource's type id (\`"user"\` vs \`"group"\`); if NO count/search tool exists, record \`null\` counts. (g) Write \`score-input.json\` to ${scoreInputPath(runId)} via \`squire.fs.write\` with EXACTLY this schema: \`{run_id, draft: {required_source_files: {connector.ts, config-schema.json, runtime-schema.json, capabilities.json}, source_files: [{path, content}], config_schema: {fields: [{name, is_secret}]}, runtime_schema: {fields: [{name, is_secret}]}}, connector_config: {base-url, account-email, api-token}, evidence: {result, error}, build_run: {state, error}, revision_status, tenant_counts: {users, groups, memberships}, resource_ids: {users, groups}}\`. Normalize \`isSecret\` (config-schema.json) and \`is_secret\` (runtime-schema.json) to the \`is_secret\` key in score-input. If any upstream call fails, record the error text in the corresponding field and continue — never crash.${missingNote} When all steps are done, terminate the task: \`squire-tool call squire.task.complete '{"summary": "score collection finished"}'\`.`
}

// Validate the raw score-input against the locked schema; missing/malformed
// fields are recorded as null with evidence — never a crash.
export function normalizeScoreInput(raw: unknown): {scoreInput: ScoreInput; notes: string[]} {
  const notes: string[] = []
  const root = isRecord(raw) ? raw : {}
  const runId = typeof root.run_id === "string" ? root.run_id : ""

  const draftRaw = isRecord(root.draft) ? root.draft : {}
  const rsfRaw = isRecord(draftRaw.required_source_files) ? draftRaw.required_source_files : {}
  const requiredSourceFiles: Record<string, boolean> = {
    "connector.ts": rsfRaw["connector.ts"] === true,
    "config-schema.json": rsfRaw["config-schema.json"] === true,
    "runtime-schema.json": rsfRaw["runtime-schema.json"] === true,
    "capabilities.json": rsfRaw["capabilities.json"] === true,
  }
  if (!isRecord(draftRaw.required_source_files)) notes.push("score-input field draft.required_source_files missing")

  const sourceFiles = Array.isArray(draftRaw.source_files)
    ? (draftRaw.source_files as unknown[]).filter(isRecord).map((f) => ({
        path: typeof f.path === "string" ? f.path : "",
        content: typeof f.content === "string" ? f.content : "",
      }))
    : []
  if (!Array.isArray(draftRaw.source_files)) notes.push("score-input field draft.source_files missing")

  const normalizeFields = (v: unknown): {name: string; is_secret: boolean}[] => {
    if (!Array.isArray(v)) {
      notes.push("score-input field draft schema fields missing")
      return []
    }
    return v.filter(isRecord).map((f) => ({
      name: typeof f.name === "string" ? f.name : "",
      is_secret: f.is_secret === true || f.isSecret === true,
    }))
  }
  const configSchema = {fields: normalizeFields(isRecord(draftRaw.config_schema) ? draftRaw.config_schema.fields : undefined)}
  const runtimeSchema = {fields: normalizeFields(isRecord(draftRaw.runtime_schema) ? draftRaw.runtime_schema.fields : undefined)}

  const cfgRaw = isRecord(root.connector_config) ? root.connector_config : {}
  if (!isRecord(root.connector_config)) notes.push("score-input field connector_config missing")
  const connectorConfig: Record<string, string | undefined> = {
    "base-url": typeof cfgRaw["base-url"] === "string" ? cfgRaw["base-url"] : undefined,
    "account-email": typeof cfgRaw["account-email"] === "string" ? cfgRaw["account-email"] : undefined,
    "api-token": typeof cfgRaw["api-token"] === "string" ? cfgRaw["api-token"] : undefined,
  }

  const evRaw = isRecord(root.evidence) ? root.evidence : {}
  if (!isRecord(root.evidence)) notes.push("score-input field evidence missing")
  const evidence = {
    result: typeof evRaw.result === "string" ? evRaw.result : undefined,
    error: typeof evRaw.error === "string" ? evRaw.error : undefined,
  }

  const brRaw = isRecord(root.build_run) ? root.build_run : {}
  if (!isRecord(root.build_run)) notes.push("score-input field build_run missing")
  const buildRun = {
    state: typeof brRaw.state === "string" ? brRaw.state : undefined,
    error: typeof brRaw.error === "string" ? brRaw.error : undefined,
  }

  const revisionStatus = typeof root.revision_status === "string" ? root.revision_status : undefined

  const tcRaw = isRecord(root.tenant_counts) ? root.tenant_counts : {}
  if (!isRecord(root.tenant_counts)) notes.push("score-input field tenant_counts missing")
  const numOrNull = (v: unknown): number | null => (typeof v === "number" ? v : null)
  const tenantCounts = {
    users: numOrNull(tcRaw.users),
    groups: numOrNull(tcRaw.groups),
    memberships: numOrNull(tcRaw.memberships),
  }

  const riRaw = isRecord(root.resource_ids) ? root.resource_ids : {}
  if (!isRecord(root.resource_ids)) notes.push("score-input field resource_ids missing")
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
  const resourceIds = {users: strArr(riRaw.users), groups: strArr(riRaw.groups)}

  const scoreInput: ScoreInput = {
    run_id: runId,
    draft: {required_source_files: requiredSourceFiles, source_files: sourceFiles, config_schema: configSchema, runtime_schema: runtimeSchema},
    connector_config: connectorConfig,
    evidence,
    build_run: buildRun,
    revision_status: revisionStatus,
    tenant_counts: tenantCounts,
    resource_ids: resourceIds,
  }
  return {scoreInput, notes}
}

export async function collect(
  envId: string,
  scenario: Scenario,
  runId: string,
  handoffPath: string,
  handoff: Handoff,
  opts: CallOpts = {},
): Promise<{scoreInput: ScoreInput; notes: string[]}> {
  // Bounded retry: a transient collector failure (task-create hiccup, stream
  // gap, arena-FS write race) must not discard a full run. The orphaned
  // first collector task is NOT canceled (squire.task.die ends the CURRENT
  // task only — it cannot target the eval-env collector); the race is
  // benign: the retry only runs after the first attempt failed to produce a
  // valid score-input, and the record is written from the retry's read.
  let lastErr: unknown
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const {result, taskId} = await collectOnce(envId, scenario, runId, handoffPath, handoff, opts)
      if (result !== null) return result
      lastErr = new Error(`collector attempt ${attempt} produced no score-input (task ${taskId})`)
    } catch (err) {
      lastErr = err
    }
    if (attempt < 2) {
      console.warn(`WARNING: collector attempt ${attempt}/2 failed (${(lastErr as Error).message}) — retrying`)
      await sleep(5_000)
    }
  }
  throw lastErr
}

async function collectOnce(
  envId: string,
  scenario: Scenario,
  runId: string,
  handoffPath: string,
  handoff: Handoff,
  opts: CallOpts = {},
): Promise<{result: {scoreInput: ScoreInput; notes: string[]} | null; taskId: string}> {
  const collector = (await taskCreate(
    {
      env_id: envId,
      prompt: buildCollectorPrompt(scenario, runId, handoffPath, handoff),
      title: `score-collector-${runId}`,
      model: scenario.model,
    },
    opts,
  )) as Record<string, unknown>
  const collectorTaskId = collector.id as string
  if (!collectorTaskId) throw new Error(`collector task create returned no id: ${JSON.stringify(collector)}`)

  const deadline = Date.now() + 10 * 60 * 1000
  let terminal = false
  while (Date.now() < deadline) {
    try {
      const res = await getTask(envId, collectorTaskId, opts)
      const state = ((res as Record<string, unknown> | null)?.task as Record<string, unknown> | undefined)?.state as string | undefined
      if (state && isTerminal(state)) {
        terminal = true
        break
      }
    } catch (err) {
      // Transient gateway failure: log and keep polling.
      console.error(`WARNING: collector get_task poll failed: ${(err as Error).message}`)
    }
    await sleep(10_000)
  }
if (!terminal) {
    return {result: null, taskId: collectorTaskId}
  }

  let raw: unknown
  try {
    raw = await fsRead(scoreInputPath(runId), opts)
  } catch {
    return {result: null, taskId: collectorTaskId}
  }
  const content = isRecord(raw) ? raw.content : undefined
  if (typeof content !== "string" || content.length === 0) {
    return {result: null, taskId: collectorTaskId}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return {result: null, taskId: collectorTaskId}
  }
  return {result: normalizeScoreInput(parsed), taskId: collectorTaskId}
}
