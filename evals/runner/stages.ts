// stages.ts — S0..S11 stage gate definitions (CXF-216 PR 1, L23).
// Every check is a pure function over the locked evidence contract.
import type {ParsedStream, ToolCallRecord} from "./stream.ts"

export interface Handoff {
  catalog_id?: string
  draft_id?: string
  upload_id?: string
  run_id?: string
  revision_id?: string
  app_id?: string
  connector_id?: string
  test_run_id?: string
  deployment_instance_id?: string
  activation_url?: string
}

export interface ScoreInput {
  run_id: string
  draft: {
    required_source_files: Record<string, boolean>
    source_files: {path: string; content: string}[]
    config_schema: {fields: {name: string; is_secret: boolean}[]}
    runtime_schema: {fields: {name: string; is_secret: boolean}[]}
  }
  connector_config: Record<string, string | undefined>
  evidence: {result?: string; error?: string}
  build_run: {state?: string; error?: string}
  revision_status?: string
  tenant_counts: {users: number | null; groups: number | null; memberships: number | null}
  resource_ids: {users: string[]; groups: string[]}
}

export interface StageCtx {
  transcript: ParsedStream
  handoff: Handoff
  scoreInput: ScoreInput
  handoffPath: string
}

export interface Stage {
  stage: string
  gate: string
  check: (ctx: StageCtx) => boolean
  evidence: (ctx: StageCtx) => string
}

const HANDOFF_FIELDS: (keyof Handoff)[] = [
  "catalog_id",
  "draft_id",
  "upload_id",
  "run_id",
  "revision_id",
  "app_id",
  "connector_id",
  "test_run_id",
  "deployment_instance_id",
  "activation_url",
]

function nonEmpty(h: Handoff, field: keyof Handoff): boolean {
  return typeof h[field] === "string" && (h[field] as string).length > 0
}

// A handoff is "empty" when NO field carries a value — the agent never wrote
// it (the L18 stalled-agent case). A PARTIAL handoff is scored from each
// stage's own evidence.
export function handoffEmpty(h: Handoff): boolean {
  return HANDOFF_FIELDS.every((f) => !nonEmpty(h, f))
}

// bash tool_call args are objects {i, command} in the real stream; fs.write
// args are objects {path, content}. Extract the command/path strings.
function bashCommand(call: ToolCallRecord): string | null {
  if (call.name !== "bash") return null
  if (typeof call.args === "string") return call.args
  if (typeof call.args === "object" && call.args !== null) {
    const command = (call.args as Record<string, unknown>).command
    return typeof command === "string" ? command : null
  }
  return null
}

function fsWritePath(call: ToolCallRecord): string | null {
  if (!call.name.endsWith("fs.write")) return null
  if (typeof call.args === "object" && call.args !== null) {
    const path = (call.args as Record<string, unknown>).path
    return typeof path === "string" ? path : null
  }
  return null
}

// A call is successful only when a tool_result was captured AND it carried no
// error — a call with no observed result (dropped stream event) must not
// count as success (silent false-green on S0/S2).
function successfulCalls(transcript: ParsedStream, nameSuffix: string) {
  return transcript.toolCalls.filter(
    (c) =>
      c.name.endsWith(nameSuffix) &&
      c.result !== undefined &&
      (c.error === undefined || c.error === null || c.error === false),
  )
}

// A PUT is observed-successful when a bash call carries -X PUT and its result
// is exactly the http_code 200 (the prompt's curl form prints only the code).
function isHttp200(result: unknown): boolean {
  if (typeof result !== "string") return false
  const trimmed = result.trim()
  return trimmed === "200" || trimmed.endsWith("\n200")
}

function successfulPutCalls(transcript: ParsedStream): ToolCallRecord[] {
  return transcript.toolCalls.filter((c) => {
    const command = bashCommand(c)
    if (command === null || !command.includes("-X PUT")) return false
    return isHttp200(c.result)
  })
}

function failedPutCalls(transcript: ParsedStream): ToolCallRecord[] {
  return transcript.toolCalls.filter((c) => {
    const command = bashCommand(c)
    if (command === null || !command.includes("-X PUT")) return false
    return !isHttp200(c.result)
  })
}

function mintIndex(transcript: ParsedStream): number {
  let idx = -1
  transcript.toolCalls.forEach((c, i) => {
    if (c.name.endsWith("mint_approval_token")) idx = i
  })
  return idx
}

function isRedemptionCall(call: ToolCallRecord): boolean {
  if (call.name.includes("force_sync") || call.name.includes("redeem")) return true
  const command = bashCommand(call)
  return command !== null && (command.includes("force_sync") || command.includes("redeem"))
}

function isTerminalComplete(call: ToolCallRecord): boolean {
  if (call.name === "squire.task.complete" || call.name.endsWith("task.complete")) return true
  // The agent prompt instructs termination via the bash form
  // `squire-tool call squire.task.complete ...` — a bash-wrapped complete
  // has name="bash" and must be recognized as the terminal call.
  const command = bashCommand(call)
  return command !== null && command.includes("task.complete")
}

// The handoff write is the ONLY permitted non-terminal call after the mint:
// squire.fs.write to the exact handoff path (object args {path} or a bash
// squire-tool call whose command names the path).
function isHandoffWrite(call: ToolCallRecord, handoffPath: string): boolean {
  const path = fsWritePath(call)
  if (path !== null) return path.includes(handoffPath)
  const command = bashCommand(call)
  return command !== null && command.includes("squire.fs.write") && command.includes(handoffPath)
}

export const STAGES: Stage[] = [
  {
    stage: "S0",
    gate: "guide read",
    check: (ctx) => successfulCalls(ctx.transcript, "get_authoring_guide").length >= 1,
    evidence: (ctx) =>
      `transcript has ${successfulCalls(ctx.transcript, "get_authoring_guide").length} successful get_authoring_guide call(s)`,
  },
{
    stage: "S1",
    gate: "catalog_id + draft_id",
    // Transcript cross-check: a fabricated handoff must not pass — the
    // create_draft call must actually appear in the transcript.
    check: (ctx) =>
      nonEmpty(ctx.handoff, "catalog_id") &&
      nonEmpty(ctx.handoff, "draft_id") &&
      successfulCalls(ctx.transcript, "create_draft").length >= 1,
    evidence: (ctx) =>
      `catalog_id=${ctx.handoff.catalog_id ? "set" : "EMPTY"}, draft_id=${ctx.handoff.draft_id ? "set" : "EMPTY"}, create_draft calls=${successfulCalls(ctx.transcript, "create_draft").length}`,
  },
  {
    stage: "S2",
    gate: "upload_id + PUTs 200",
    check: (ctx) =>
      nonEmpty(ctx.handoff, "upload_id") &&
      successfulCalls(ctx.transcript, "create_draft_source_upload").length >= 1 &&
      successfulPutCalls(ctx.transcript).length >= 1 &&
      failedPutCalls(ctx.transcript).length === 0,
    evidence: (ctx) => {
      const uploads = successfulCalls(ctx.transcript, "create_draft_source_upload").length
      const goodPuts = successfulPutCalls(ctx.transcript).length
      const badPuts = failedPutCalls(ctx.transcript).length
      return `upload_id=${ctx.handoff.upload_id ? "set" : "EMPTY"}, successful upload calls=${uploads}, PUTs with 200=${goodPuts}, PUTs lacking 200=${badPuts}`
    },
  },
  {
    stage: "S3",
    gate: "required source files",
    check: (ctx) => {
      const rsf = ctx.scoreInput.draft.required_source_files
      return Object.values(rsf).length >= 4 && Object.values(rsf).every((v) => v === true)
    },
    evidence: (ctx) => {
      const rsf = ctx.scoreInput.draft.required_source_files
      const missing = Object.entries(rsf).filter(([, v]) => v !== true).map(([k]) => k)
      return missing.length === 0 ? "all 4 required source files present" : `missing: ${missing.join(", ")}`
    },
  },
{
    stage: "S4",
    gate: "build run_id",
    check: (ctx) =>
      nonEmpty(ctx.handoff, "run_id") && successfulCalls(ctx.transcript, "build_bundle").length >= 1,
    evidence: (ctx) =>
      `run_id=${ctx.handoff.run_id ? "set" : "EMPTY"}, build_bundle calls=${successfulCalls(ctx.transcript, "build_bundle").length}`,
  },
  {
    stage: "S5",
    gate: "RUN_STATE_SUCCEEDED + revision_id",
    check: (ctx) =>
      ctx.scoreInput.build_run.state === "RUN_STATE_SUCCEEDED" && nonEmpty(ctx.handoff, "revision_id"),
    evidence: (ctx) =>
      `build_run.state=${ctx.scoreInput.build_run.state ?? "null"}, revision_id=${ctx.handoff.revision_id ? "set" : "EMPTY"}`,
  },
{
    stage: "S6",
    gate: "app_id",
    check: (ctx) =>
      nonEmpty(ctx.handoff, "app_id") && successfulCalls(ctx.transcript, "apps_create").length >= 1,
    evidence: (ctx) =>
      `app_id=${ctx.handoff.app_id ? "set" : "EMPTY"}, apps_create calls=${successfulCalls(ctx.transcript, "apps_create").length}`,
  },
{
    stage: "S7",
    gate: "connector_id",
    check: (ctx) =>
      nonEmpty(ctx.handoff, "connector_id") && successfulCalls(ctx.transcript, "provision_connector").length >= 1,
    evidence: (ctx) =>
      `connector_id=${ctx.handoff.connector_id ? "set" : "EMPTY"}, provision_connector calls=${successfulCalls(ctx.transcript, "provision_connector").length}`,
  },
  {
    stage: "S8",
    gate: "credentials configured",
    check: (ctx) => {
      const cfg = ctx.scoreInput.connector_config
      return Boolean(cfg["base-url"]) && Boolean(cfg["account-email"]) && Boolean(cfg["api-token"])
    },
    evidence: (ctx) => {
      const cfg = ctx.scoreInput.connector_config
      return `base-url=${cfg["base-url"] ? "set" : "EMPTY"}, account-email=${cfg["account-email"] ? "set" : "EMPTY"}, api-token=${cfg["api-token"] ? "set" : "EMPTY"}`
    },
  },
{
    stage: "S9",
    gate: "test_run_id",
    check: (ctx) =>
      nonEmpty(ctx.handoff, "test_run_id") && successfulCalls(ctx.transcript, "run_draft_test_sync").length >= 1,
    evidence: (ctx) =>
      `test_run_id=${ctx.handoff.test_run_id ? "set" : "EMPTY"}, run_draft_test_sync calls=${successfulCalls(ctx.transcript, "run_draft_test_sync").length}`,
  },
  {
    stage: "S10",
    gate: "durable PASS evidence",
    check: (ctx) => ctx.scoreInput.evidence.result === "PASS",
    evidence: (ctx) => `evidence.result=${ctx.scoreInput.evidence.result ?? "null"}${ctx.scoreInput.evidence.error ? ` (error: ${ctx.scoreInput.evidence.error})` : ""}`,
  },
  {
    stage: "S11",
    gate: "handoff discipline",
check: (ctx) => {
      const h = ctx.handoff
      if (!nonEmpty(h, "deployment_instance_id") || !nonEmpty(h, "activation_url")) return false
      if (!HANDOFF_FIELDS.every((f) => nonEmpty(h, f))) return false
      // Transcript cross-check: a fabricated deployment_instance_id must
      // not pass — the deploy call must actually appear in the transcript.
      if (successfulCalls(ctx.transcript, "deploy_connector_instance").length < 1) return false
      const mintIdx = mintIndex(ctx.transcript)
      if (mintIdx < 0) return false
const after = ctx.transcript.toolCalls.slice(mintIdx + 1)
      // The handoff write must actually occur AFTER the mint (a handoff
      // written before deploy+mint violates the stop rule).
      if (!after.some((c) => isHandoffWrite(c, ctx.handoffPath))) return false
      // Allowed after the mint: the handoff write, then the terminal
      // squire.task.complete (the task must terminate for the runner to
      // score; harness bookkeeping, not funnel activity). Strip ALL
      // trailing terminal calls (an agent may complete more than once).
      const body = [...after]
      while (body.length > 0 && isTerminalComplete(body[body.length - 1])) body.pop()
      for (const call of body) {
        if (!isHandoffWrite(call, ctx.handoffPath)) return false
      }
      // force_sync/redeem are NEVER legitimate (the stop rule forbids them
      // outright) — flag them anywhere in the transcript, pre- or post-mint.
      if (ctx.transcript.toolCalls.some((c) => isRedemptionCall(c))) return false
      return true
    },
    evidence: (ctx) => {
      const h = ctx.handoff
      const mintIdx = mintIndex(ctx.transcript)
      const after = mintIdx >= 0 ? ctx.transcript.toolCalls.slice(mintIdx + 1) : ctx.transcript.toolCalls
      const body = [...after]
      while (body.length > 0 && isTerminalComplete(body[body.length - 1])) body.pop()
      const nonWriteAfter = body.filter((c) => !isHandoffWrite(c, ctx.handoffPath))
      const redemption = after.filter((c) => isRedemptionCall(c))
      return `deployment_instance_id=${h.deployment_instance_id ? "set" : "EMPTY"}, activation_url=${h.activation_url ? "set" : "EMPTY"}, all10=${HANDOFF_FIELDS.every((f) => nonEmpty(h, f)) ? "yes" : "no"}, calls after mint=${after.length}, non-handoff after mint=${nonWriteAfter.length}, redemption calls after mint=${redemption.length}`
    },
  },
]

export const SKIPPED_STAGES: {stage: string; gate: string}[] = [
  {stage: "S11b", gate: "REVISION_STATUS_ACTIVE"},
  {stage: "S11c", gate: "SYNC_STATUS_DONE"},
]
