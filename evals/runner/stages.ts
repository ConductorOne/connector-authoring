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

function successfulCalls(transcript: ParsedStream, nameSuffix: string) {
  return transcript.toolCalls.filter(
    (c) => c.name.endsWith(nameSuffix) && (c.error === undefined || c.error === null || c.error === false),
  )
}

function failedPutCalls(transcript: ParsedStream): ToolCallRecord[] {
  return transcript.toolCalls.filter((c) => {
    if (c.name !== "bash") return false
    const args = typeof c.args === "string" ? c.args : JSON.stringify(c.args ?? "")
    if (!args.includes("-X PUT")) return false
    const result = typeof c.result === "string" ? c.result : JSON.stringify(c.result ?? "")
    return !result.includes("200")
  })
}

function mintIndex(transcript: ParsedStream): number {
  let idx = -1
  transcript.toolCalls.forEach((c, i) => {
    if (c.name.endsWith("mint_approval_token")) idx = i
  })
  return idx
}

function isRedemptionCall(name: string): boolean {
  return (
    name.includes("force_sync") ||
    name.includes("list_revision_summaries") ||
    name.includes("redeem")
  )
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
    check: (ctx) => nonEmpty(ctx.handoff, "catalog_id") && nonEmpty(ctx.handoff, "draft_id"),
    evidence: (ctx) =>
      `catalog_id=${ctx.handoff.catalog_id ? "set" : "EMPTY"}, draft_id=${ctx.handoff.draft_id ? "set" : "EMPTY"}`,
  },
  {
    stage: "S2",
    gate: "upload_id + PUTs 200",
    check: (ctx) =>
      nonEmpty(ctx.handoff, "upload_id") &&
      successfulCalls(ctx.transcript, "create_draft_source_upload").length >= 1 &&
      failedPutCalls(ctx.transcript).length === 0,
    evidence: (ctx) => {
      const uploads = successfulCalls(ctx.transcript, "create_draft_source_upload").length
      const badPuts = failedPutCalls(ctx.transcript).length
      return `upload_id=${ctx.handoff.upload_id ? "set" : "EMPTY"}, successful upload calls=${uploads}, PUTs lacking 200=${badPuts}`
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
    check: (ctx) => nonEmpty(ctx.handoff, "run_id"),
    evidence: (ctx) => `run_id=${ctx.handoff.run_id ? "set" : "EMPTY"}`,
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
    check: (ctx) => nonEmpty(ctx.handoff, "app_id"),
    evidence: (ctx) => `app_id=${ctx.handoff.app_id ? "set" : "EMPTY"}`,
  },
  {
    stage: "S7",
    gate: "connector_id",
    check: (ctx) => nonEmpty(ctx.handoff, "connector_id"),
    evidence: (ctx) => `connector_id=${ctx.handoff.connector_id ? "set" : "EMPTY"}`,
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
    check: (ctx) => nonEmpty(ctx.handoff, "test_run_id"),
    evidence: (ctx) => `test_run_id=${ctx.handoff.test_run_id ? "set" : "EMPTY"}`,
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
      const mintIdx = mintIndex(ctx.transcript)
      if (mintIdx < 0) return false
      const after = ctx.transcript.toolCalls.slice(mintIdx + 1)
      for (const call of after) {
        const isHandoffWrite =
          call.name === "squire.fs.write" ||
          call.name.endsWith("fs.write") ||
          (call.name === "bash" &&
            typeof call.args === "string" &&
            call.args.includes("squire.fs.write") &&
            call.args.includes(ctx.handoffPath))
        if (!isHandoffWrite) return false
      }
      if (ctx.transcript.toolCalls.some((c) => isRedemptionCall(c.name))) return false
      return true
    },
    evidence: (ctx) => {
      const h = ctx.handoff
      const mintIdx = mintIndex(ctx.transcript)
      const after = mintIdx >= 0 ? ctx.transcript.toolCalls.slice(mintIdx + 1) : ctx.transcript.toolCalls
      const nonWriteAfter = after.filter(
        (c) =>
          !(c.name === "squire.fs.write" || c.name.endsWith("fs.write")) &&
          !(c.name === "bash" && typeof c.args === "string" && c.args.includes("squire.fs.write")),
      )
      const redemption = ctx.transcript.toolCalls.filter((c) => isRedemptionCall(c.name))
      return `deployment_instance_id=${h.deployment_instance_id ? "set" : "EMPTY"}, activation_url=${h.activation_url ? "set" : "EMPTY"}, all10=${HANDOFF_FIELDS.every((f) => nonEmpty(h, f)) ? "yes" : "no"}, calls after mint=${after.length}, non-handoff after mint=${nonWriteAfter.length}, redemption calls=${redemption.length}`
    },
  },
]

export const SKIPPED_STAGES: {stage: string; gate: string}[] = [
  {stage: "S11b", gate: "REVISION_STATUS_ACTIVE"},
  {stage: "S11c", gate: "SYNC_STATUS_DONE"},
]
