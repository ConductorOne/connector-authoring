// stages.ts — S0..S11 stage gate definitions.
// Every check is a pure function over the locked evidence contract.
import type {ParsedStream, ToolCallRecord} from "./stream.ts"
import {isRecord} from "./scenario.ts"
import type {ExpectedAccessModel, ExpectedParkEvidence} from "./scenario.ts"

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
  // Pre-1 fields (all optional — the existing test ctx() helpers compile
  // unchanged). kind === "pre1" selects the PRE1_STAGES gate set.
  kind?: "funnel" | "pre1"
  pre1?: Pre1Artifact | null
  expected?: {decision: "proceed" | "park"; accessModel?: ExpectedAccessModel; parkEvidence?: ExpectedParkEvidence}
}

export interface Pre1AccessModel {
  resource_types: {id: string; traits: string[]}[]
  entitlements: {slug: string; display_name?: string; grantable_principals?: string[]; stable_id_shape?: string}[]
  grants: {resource_type: string; entitlement: string; principal_type: string}[]
  id_compatibility: unknown[]
  provisioning: {resource_type: string; provisionable: boolean; justification: string}[]
}

export interface Pre1Sourcing {
  spec_url: string
  fetched_at: string
  authority_rung: string
  spec_bytes: number
}

export interface Pre1ParkEvidence {
  spec_version_checked: string
  missing_paths: string[]
  vendor_doc: string
  revisit_trigger: string
}

export interface Pre1Artifact {
  decision: "proceed" | "park"
  access_model?: Pre1AccessModel
  sourcing?: Pre1Sourcing
  park_evidence?: Pre1ParkEvidence
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

// The agent-written handoff is UNTRUSTED. The collector reads it from the
// run channel as a tool result — strip characters that could inject
// instructions into the collector's transcription (quotes, braces,
// semicolons, control chars) and coerce non-string fields to empty.
export function sanitizeHandoffValue(v: unknown): string {
  if (typeof v !== "string") return ""
  return v.replace(/[^\w.:/?#=&@%+-]/g, "")
}

export function sanitizeHandoff(h: Handoff): Handoff {
  const out: Handoff = {}
  for (const f of HANDOFF_FIELDS) {
    out[f] = sanitizeHandoffValue(h[f])
  }
  return out
}

// bash tool_call args are objects {i, command} in the real stream; the
// driver.write_file args are objects {path, content}. Extract the
// command/path strings.
function bashCommand(call: ToolCallRecord): string | null {
  if (call.name !== "bash") return null
  if (typeof call.args === "string") return call.args
  if (typeof call.args === "object" && call.args !== null) {
    const command = (call.args as Record<string, unknown>).command
    return typeof command === "string" ? command : null
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
  // The prompt's curl form (-w "%{http_code}") prints codes with no trailing
  // newline, so a batched bash call can emit "200200200200" or a mix like
  // "200200\n200200". One rule covers all: every non-empty line must be one
  // or more 200 codes.
  const lines = result.trim().split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
  return lines.length > 0 && lines.every((l) => /^(200)+$/.test(l))
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
  return call.name === "driver.complete_run"
}

// The handoff write is the ONLY permitted non-terminal call after the mint:
// driver.write_file to the exact handoff path (object args {path}).
function isHandoffWrite(call: ToolCallRecord, handoffPath: string): boolean {
  return call.name === "driver.write_file" && (call.args as Record<string, unknown> | null)?.path === handoffPath
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
      // Transcript cross-checks: fabricated deployment_instance_id or
      // activation_url must not pass — the deploy AND mint calls must
      // actually appear and succeed in the transcript.
      if (successfulCalls(ctx.transcript, "deploy_connector_instance").length < 1) return false
      if (successfulCalls(ctx.transcript, "mint_approval_token").length < 1) return false
      const mintIdx = mintIndex(ctx.transcript)
      if (mintIdx < 0) return false
      const after = ctx.transcript.toolCalls.slice(mintIdx + 1)
      // The handoff write must actually occur AFTER the mint (a handoff
      // written before deploy+mint violates the stop rule).
      if (!after.some((c) => isHandoffWrite(c, ctx.handoffPath))) return false
      // Allowed after the mint: the handoff write, then the terminal
      // driver.complete_run (the run must terminate for the runner to
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

// --- pre-1 gates (P0..P4) ---
// The pre1 artifact is UNTRUSTED (agent-written). Every check type-checks it
// defensively and never throws; a malformed artifact fails its gate.

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0
}

// Canonicalize BOTH sides identically: {id, traits} with traits sorted, then
// set-compare. Extra fields on either side are dropped by the canonical form.
function canonicalResourceType(rt: {id: string; traits: string[]}): string {
  return JSON.stringify({id: rt.id, traits: [...rt.traits].sort()})
}

function canonicalGrant(g: {resource_type: string; entitlement: string; principal_type: string}): string {
  return JSON.stringify({resource_type: g.resource_type, entitlement: g.entitlement, principal_type: g.principal_type})
}

function setEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((v, i) => v === sortedB[i])
}

// Defensive access-model dimension checks shared by P2's check and evidence.
function accessModelDimensions(ctx: StageCtx): {
  rtMatch: boolean
  entMatch: boolean
  grantMatch: boolean
  idcCount: number
  provisioning: "all justified" | "missing justification" | "non-boolean provisionable" | "absent"
} {
  const pre1 = ctx.pre1
  const expected = ctx.expected?.accessModel
  if (pre1 === null || pre1 === undefined || !isRecord(pre1.access_model) || expected === undefined) {
    return {rtMatch: false, entMatch: false, grantMatch: false, idcCount: 0, provisioning: "absent"}
  }
  const am = pre1.access_model
  const rtMatch =
    Array.isArray(am.resource_types) &&
    setEqual(
      am.resource_types
        .filter((rt) => isRecord(rt) && typeof rt.id === "string" && Array.isArray(rt.traits) && rt.traits.every((t) => typeof t === "string"))
        .map((rt) => canonicalResourceType(rt as {id: string; traits: string[]})),
      expected.resource_types.map(canonicalResourceType),
    )
  const entMatch =
    Array.isArray(am.entitlements) &&
    setEqual(
      am.entitlements.filter((e) => isRecord(e) && typeof e.slug === "string").map((e) => (e as {slug: string}).slug),
      expected.entitlements.map((e) => e.slug),
    )
  const grantMatch =
    Array.isArray(am.grants) &&
    setEqual(
      am.grants
        .filter((g) => isRecord(g) && typeof g.resource_type === "string" && typeof g.entitlement === "string" && typeof g.principal_type === "string")
        .map((g) => canonicalGrant(g as {resource_type: string; entitlement: string; principal_type: string})),
      expected.grants.map(canonicalGrant),
    )
  const idcCount = Array.isArray(am.id_compatibility) ? am.id_compatibility.length : 0
  let provisioning: "all justified" | "missing justification" | "non-boolean provisionable" | "absent" = "absent"
  if (Array.isArray(am.provisioning)) {
    if (am.provisioning.length === 0) {
      provisioning = "missing justification"
    } else if (am.provisioning.some((p) => !isRecord(p) || typeof p.provisionable !== "boolean")) {
      provisioning = "non-boolean provisionable"
    } else if (am.provisioning.some((p) => !nonEmptyString((p as Record<string, unknown>).justification))) {
      provisioning = "missing justification"
    } else {
      provisioning = "all justified"
    }
  }
  return {rtMatch, entMatch, grantMatch, idcCount, provisioning}
}

const P0: Stage = {
  stage: "P0",
  gate: "artifact written",
  check: (ctx) => {
    const pre1 = ctx.pre1
    return pre1 !== null && pre1 !== undefined && (pre1.decision === "proceed" || pre1.decision === "park")
  },
  evidence: (ctx) => {
    const pre1 = ctx.pre1
    const present = pre1 !== null && pre1 !== undefined ? "yes" : "no"
    const decision = pre1 !== null && pre1 !== undefined && typeof pre1.decision === "string" ? pre1.decision : "none"
    return `pre1.json present=${present}, decision=${decision}`
  },
}

const P1: Stage = {
  stage: "P1",
  gate: "decision correctness",
  check: (ctx) => {
    const pre1 = ctx.pre1
    if (pre1 === null || pre1 === undefined) return false
    return pre1.decision === ctx.expected?.decision
  },
  evidence: (ctx) => {
    const pre1 = ctx.pre1
    const decision = pre1 !== null && pre1 !== undefined && typeof pre1.decision === "string" ? pre1.decision : "none"
    const expected = ctx.expected?.decision ?? "none"
    return `decision=${decision}, expected=${expected}`
  },
}

const P2: Stage = {
  stage: "P2",
  gate: "access-model match",
  check: (ctx) => {
    const d = accessModelDimensions(ctx)
    return d.rtMatch && d.entMatch && d.grantMatch && d.idcCount > 0 && d.provisioning === "all justified"
  },
  evidence: (ctx) => {
    const d = accessModelDimensions(ctx)
    return `resource_types=${d.rtMatch ? "match" : "mismatch"}, entitlements=${d.entMatch ? "match" : "mismatch"}, grants=${d.grantMatch ? "match" : "mismatch"}, id_compatibility=${d.idcCount}, provisioning=${d.provisioning}`
  },
}

const P3: Stage = {
  stage: "P3",
  gate: "sourcing provenance",
  check: (ctx) => {
    const pre1 = ctx.pre1
    if (pre1 === null || pre1 === undefined || !isRecord(pre1.sourcing)) return false
    const s = pre1.sourcing
    if (!nonEmptyString(s.spec_url) || !nonEmptyString(s.fetched_at) || !nonEmptyString(s.authority_rung)) return false
    return typeof s.spec_bytes === "number" && Number.isFinite(s.spec_bytes) && Number.isInteger(s.spec_bytes) && s.spec_bytes > 0 && s.spec_bytes < 1048576
  },
  evidence: (ctx) => {
    const pre1 = ctx.pre1
    const s = isRecord(pre1?.sourcing) ? pre1.sourcing : null
    const specUrl = s !== null && nonEmptyString(s.spec_url) ? "set" : "EMPTY"
    const fetchedAt = s !== null && nonEmptyString(s.fetched_at) ? "set" : "EMPTY"
    const authorityRung = s !== null && nonEmptyString(s.authority_rung) ? "set" : "EMPTY"
    const specBytes = s !== null && typeof s.spec_bytes === "number" ? String(s.spec_bytes) : "none"
    return `spec_url=${specUrl}, fetched_at=${fetchedAt}, authority_rung=${authorityRung}, spec_bytes=${specBytes}`
  },
}

const P4: Stage = {
  stage: "P4",
  gate: "park evidence",
  check: (ctx) => {
    const pre1 = ctx.pre1
    if (pre1 === null || pre1 === undefined || !isRecord(pre1.park_evidence)) return false
    const pe = pre1.park_evidence
    if (!nonEmptyString(pe.spec_version_checked) || !nonEmptyString(pe.vendor_doc) || !nonEmptyString(pe.revisit_trigger)) return false
    return Array.isArray(pe.missing_paths) && pe.missing_paths.length > 0 && pe.missing_paths.every((p) => typeof p === "string" && p.length > 0)
  },
  evidence: (ctx) => {
    const pre1 = ctx.pre1
    const pe = isRecord(pre1?.park_evidence) ? pre1.park_evidence : null
    const specVersion = pe !== null && nonEmptyString(pe.spec_version_checked) ? "set" : "EMPTY"
    const vendorDoc = pe !== null && nonEmptyString(pe.vendor_doc) ? "set" : "EMPTY"
    const revisitTrigger = pe !== null && nonEmptyString(pe.revisit_trigger) ? "set" : "EMPTY"
    const missingPaths = pe !== null && Array.isArray(pe.missing_paths) ? pe.missing_paths.filter((p) => typeof p === "string" && p.length > 0).length : 0
    return `spec_version_checked=${specVersion}, missing_paths=${missingPaths}, vendor_doc=${vendorDoc}, revisit_trigger=${revisitTrigger}`
  },
}

export const PRE1_STAGES: Record<"proceed" | "park", Stage[]> = {
  proceed: [P0, P1, P2, P3],
  park: [P0, P1, P4],
}
