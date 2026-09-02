// readiness.ts — hard readiness gate for eval envs (CXF-216 PR 1, L20).
import {getEnv, getTask, fsRead, taskCreate, taskStream, type CallOpts} from "./squire.ts"
import type {Scenario} from "./scenario.ts"

export class ReadinessError extends Error {
  constructor(message: string) {
    super(`READINESS FAILURE: ${message}`)
    this.name = "ReadinessError"
  }
}

// Full funnel tool surface (L31) — used only for the WARNING; the gate stays
// the plan's five scenario.readinessTools.
export const FUNNEL_TOOLS: string[] = [
  "c1_connector_authoring_create_draft_source_upload",
  "c1_connector_authoring_finalize_draft_source_upload",
  "c1_connector_authoring_get_draft",
  "c1_connector_authoring_build_bundle",
  "c1_connector_authoring_get_run",
  "c1_apps_create",
  "c1_connector_authoring_provision_connector",
  "c1_connector_service_get",
  "c1_connector_service_update",
  "c1_connector_authoring_run_draft_test_sync",
  "c1_connector_authoring_get_test_run_evidence",
  "c1_connector_authoring_deploy_connector_instance",
  "c1_connector_authoring_mint_approval_token",
  "c1_connector_authoring_list_revision_summaries",
]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function probeToolsPath(runId: string): string {
  return `/current-tasks/evals/${runId}/probe-tools.txt`
}

function buildProbePrompt(scenario: Scenario, runId: string): string {
  const tools = scenario.readinessTools.map((t) => `- ${t}`).join("\n")
  return `You are a readiness probe for eval run ${runId}. Run these commands in order and report their outputs verbatim:

1. squire-tool call squire.wait_for_services '{}'
2. squire-tool list --filter c1_connector_authoring
3. squire-tool list

Then write the FULL output of command 3 to the arena FS at ${probeToolsPath(runId)} using:
squire-tool call squire.fs.write '{"path": "${probeToolsPath(runId)}", "content": "<the full output of command 3>"}'

Then check whether all five of these tool names are present in the output of command 2:
${tools}

If all five are present, print exactly "PROBE PASS" as your final line. Otherwise print exactly "PROBE FAIL" as your final line. Then terminate the task: squire-tool call squire.task.complete '{"summary": "readiness probe finished"}'`
}

function isTerminal(state: unknown): boolean {
  return state === "completed" || state === "failed" || state === "canceled"
}

async function waitForTaskTerminal(
  envId: string,
  taskId: string,
  timeoutMs: number,
  opts: CallOpts,
): Promise<{state: string; timedOut: boolean}> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await getTask(envId, taskId, opts)
      const state = ((res as Record<string, unknown> | null)?.task as Record<string, unknown> | undefined)?.state as string | undefined
      if (state && isTerminal(state)) return {state, timedOut: false}
    } catch (err) {
      // Transient gateway failure: log and keep polling.
      console.error(`WARNING: get_task poll failed: ${(err as Error).message}`)
    }
    await sleep(10_000)
  }
  return {state: "running", timedOut: true}
}

// Read the probe's tool list: prefer the arena file the probe writes; fall
// back to scanning the task stream for the five readiness tool names.
async function readProbeToolList(
  envId: string,
  taskId: string,
  runId: string,
  opts: CallOpts,
): Promise<string | null> {
  try {
    const res = (await fsRead(probeToolsPath(runId), opts)) as Record<string, unknown>
    const content = res.content as string | undefined
    if (typeof content === "string" && content.length > 0) return content
  } catch {
    // fall through to stream scan
  }
// Stream fallback: concatenate every tool result and text delta. The real
  // stream puts tool_result text in the TOP-LEVEL `message` (data carries
  // only tool_name/is_error) — read both.
  let sinceSeq = 0
  const parts: string[] = []
  for (;;) {
    let page: Record<string, unknown>
    try {
      page = (await taskStream(envId, taskId, {sinceSeq, limit: 500}, opts)) as Record<string, unknown>
    } catch (err) {
      // Transient stream hiccup: return what we have.
      console.error(`WARNING: probe stream read failed: ${(err as Error).message}`)
      break
    }
    const events = (page?.events ?? []) as Record<string, unknown>[]
    for (const ev of events) {
      if (typeof ev.message === "string" && ev.message.length > 0) parts.push(ev.message)
      const data = (ev.data ?? {}) as Record<string, unknown>
      for (const key of ["result", "output"]) {
        const v = data[key]
        if (typeof v === "string") parts.push(v)
      }
    }
    const nextSeq = page.next_seq as number | undefined
    if (nextSeq === undefined || nextSeq <= sinceSeq) break
    sinceSeq = nextSeq
  }
  const text = parts.join("\n")
  return text.length > 0 ? text : null
}

export async function waitForReady(
  envId: string,
  scenario: Scenario,
  runId: string,
  opts: CallOpts = {},
): Promise<{funnelToolsPresent: boolean}> {
  // (a) env status running (10 min timeout)
  const envDeadline = Date.now() + 10 * 60 * 1000
  let envStatus: unknown = "pending"
  let envPollErrors = 0
  while (Date.now() < envDeadline) {
    try {
      const env = (await getEnv(envId, opts)) as Record<string, unknown> | null
      envStatus = env?.status ?? "unknown"
    } catch (err) {
      // Transient gateway failure: log and keep polling.
      envPollErrors++
      console.error(`WARNING: get_env poll failed: ${(err as Error).message}`)
    }
    if (envStatus === "running") break
    await sleep(10_000)
  }
  if (envStatus !== "running") {
    const cause = envPollErrors > 0 ? ` (${envPollErrors} get_env poll(s) failed)` : ""
    throw new ReadinessError(`env ${envId} not running after 10 min (status ${String(envStatus)})${cause}`)
  }

  // (b)+(c) one probe task: wait_for_services settled, then tool-list check
  const probe = (await taskCreate(
    {
      env_id: envId,
      prompt: buildProbePrompt(scenario, runId),
      title: `readiness-probe-${runId}`,
    },
    opts,
  )) as Record<string, unknown>
  const probeTaskId = probe.id as string
  if (!probeTaskId) throw new ReadinessError(`probe task create returned no id: ${JSON.stringify(probe)}`)

  const {state, timedOut} = await waitForTaskTerminal(envId, probeTaskId, 10 * 60 * 1000, opts)
  if (timedOut) {
    throw new ReadinessError(`readiness probe for ${envId} timed out after 10 min`)
  }

  const toolList = await readProbeToolList(envId, probeTaskId, runId, opts)
  if (!toolList) {
    throw new ReadinessError(`readiness probe for ${envId} produced no tool list (probe state ${state})`)
  }

  const missing = scenario.readinessTools.filter((t) => !toolList.includes(t))
  if (missing.length > 0) {
    throw new ReadinessError(
      `env ${envId} missing readiness tools: ${missing.join(", ")} (probe state ${state})`,
    )
  }

// WARNING for absent funnel tools (late-stage failures are scored outcomes,
  // not gate failures); the run meta records funnel_tools_present.
  const absentFunnel = FUNNEL_TOOLS.filter((t) => !toolList.includes(t))
  if (absentFunnel.length > 0) {
    console.warn(
      `WARNING: env ${envId} lacks funnel tools (late-stage failures will be scored outcomes): ${absentFunnel.join(", ")}`,
    )
  }
  return {funnelToolsPresent: absentFunnel.length === 0}
}
