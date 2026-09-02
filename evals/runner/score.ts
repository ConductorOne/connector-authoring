// score.ts — deterministic scorer.
import {SKIPPED_STAGES, STAGES, handoffEmpty, type StageCtx} from "./stages.ts"

export interface StageRow {
  stage: string
  gate: string
  pass: boolean
  first_pass: boolean
  attempts: number
  evidence: string
}

export interface ScoreResult {
  stageRows: StageRow[]
  parity_verdict: "PASS" | "FAIL"
  parity_evidence: string
  parity_tenant: string | Record<string, unknown>
  parity_tenant_evidence: string
  hygiene_verdict: "PASS" | "FAIL"
  hygiene_evidence: string
  handoff_discipline_verdict: boolean
  recovery_cycles: number
  first_pass_rate: number
  funnel: string[]
}

const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_TOTAL_BYTES = 16 * 1024 * 1024
const MAX_FILES = 256

// L35: five literal-substring source checks over connector.ts (no AST, no
// regex beyond plain substring). The account_id check is STRUCTURAL: the
// literal must appear inside a `query:` object of a GET/walk call (the
// under-sync trap (a) is only avoided when account_id is actually passed as
// the query param — a comment or config string must not satisfy it).
function accountIdInQuery(source: string): boolean {
  // Check EVERY occurrence: the literal must sit inside a `query:` object
  // that is itself inside a directory.GET / walk call — a comment or config
  // string mentioning account_id must not satisfy the under-sync trap.
  let idx = source.indexOf("account_id")
  while (idx >= 0) {
    // Skip occurrences on comment lines (a fully commented-out GET example
    // must not false-green).
    const lineStart = source.lastIndexOf("\n", idx) + 1
    const line = source.slice(lineStart, idx).trim()
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) {
      idx = source.indexOf("account_id", idx + 1)
      continue
    }
    const before = source.slice(Math.max(0, idx - 200), idx)
    const queryIdx = before.lastIndexOf("query:")
    if (queryIdx >= 0 && !before.slice(queryIdx).includes("}")) {
      const callBefore = before.slice(0, queryIdx)
      const callIdx = Math.max(
        callBefore.lastIndexOf("directory.GET"),
        callBefore.lastIndexOf("directory.walk"),
        callBefore.lastIndexOf("walk("),
      )
      // No line comment between the call and the query object.
      if (callIdx >= 0 && !callBefore.slice(callIdx).includes("//")) return true
    }
    idx = source.indexOf("account_id", idx + 1)
  }
  return false
}

function parityChecks(source: string): {name: string; ok: boolean}[] {
  const configLiterals = ['config("base-url")', 'config("account-email")', 'config("api-token")']
  return [
    {name: "account_id", ok: accountIdInQuery(source)},
    {name: "user.title", ok: source.includes("user.title")},
    {name: "totalPath", ok: source.includes("totalPath")},
    {
      name: "config literals",
      ok: configLiterals.every((l) => source.includes(l)),
    },
    {name: "newUserResource + user.id", ok: source.includes("newUserResource") && source.includes("user.id")},
  ]
}

function connectorSource(ctx: StageCtx): string | null {
  const file = ctx.scoreInput.draft.source_files.find((f) => f.path === "connector.ts")
  return file ? file.content : null
}

function computeParity(ctx: StageCtx): {verdict: "PASS" | "FAIL"; evidence: string} {
  const source = connectorSource(ctx)
  if (source === null) {
    return {verdict: "FAIL", evidence: "connector source unavailable (get_draft returned no content)"}
  }
  const checks = parityChecks(source)
  const failed = checks.filter((c) => !c.ok)
  if (failed.length === 0) {
    return {verdict: "PASS", evidence: "all 5 static source checks pass (account_id, user.title, totalPath, config literals, newUserResource + user.id)"}
  }
  return {
    verdict: "FAIL",
    evidence: `parity FAIL: missing literal(s): ${failed.map((c) => c.name).join(", ")}`,
  }
}

function computeParityTenant(ctx: StageCtx): string | Record<string, unknown> {
  const counts = ctx.scoreInput.tenant_counts
  const ids = ctx.scoreInput.resource_ids
  const allZero =
    (counts.users === null || counts.users === 0) &&
    (counts.groups === null || counts.groups === 0) &&
    (counts.memberships === null || counts.memberships === 0)
  if (allZero) {
    return "not_applicable"
  }
  return {users: counts.users, groups: counts.groups, memberships: counts.memberships, resource_ids: ids}
}

function schemaFieldNames(schema: {fields: {name: string; is_secret: boolean}[]}): string[] {
  return schema.fields.map((f) => f.name).sort()
}

function computeHygiene(ctx: StageCtx): {verdict: "PASS" | "FAIL"; evidence: string} {
  const rsf = ctx.scoreInput.draft.required_source_files
  const missingFiles = Object.entries(rsf).filter(([, v]) => v !== true).map(([k]) => k)
  if (missingFiles.length > 0) {
    return {verdict: "FAIL", evidence: `hygiene FAIL: required source files missing: ${missingFiles.join(", ")}`}
  }

  const configSchema = ctx.scoreInput.draft.config_schema
  const runtimeSchema = ctx.scoreInput.draft.runtime_schema
  const configNames = schemaFieldNames(configSchema)
  const runtimeNames = schemaFieldNames(runtimeSchema)
  const sameNames = configNames.length === runtimeNames.length && configNames.every((n, i) => n === runtimeNames[i])
  if (!sameNames) {
    return {
      verdict: "FAIL",
      evidence: `hygiene FAIL: dual-schema field mismatch (config-schema: ${configNames.join(",")}; runtime-schema: ${runtimeNames.join(",")})`,
    }
  }

  const apiTokenSecret =
    configSchema.fields.find((f) => f.name === "api-token")?.is_secret === true &&
    runtimeSchema.fields.find((f) => f.name === "api-token")?.is_secret === true
  if (!apiTokenSecret) {
    return {verdict: "FAIL", evidence: "hygiene FAIL: api-token not is_secret in both schemas"}
  }

  const plaintext = ctx.scoreInput.draft.source_files.some((f) => f.content.includes("fixture-token"))
  if (plaintext) {
    return {verdict: "FAIL", evidence: "hygiene FAIL: literal fixture-token appears in an uploaded source file"}
  }

  const files = ctx.scoreInput.draft.source_files
  const overSize = files.filter((f) => f.content.length > MAX_FILE_BYTES)
  const totalBytes = files.reduce((acc, f) => acc + f.content.length, 0)
  if (overSize.length > 0 || totalBytes > MAX_TOTAL_BYTES || files.length > MAX_FILES) {
    return {
      verdict: "FAIL",
      evidence: `hygiene FAIL: bundle caps exceeded (files=${files.length}/${MAX_FILES}, total=${totalBytes}/${MAX_TOTAL_BYTES}, oversized=${overSize.map((f) => f.path).join(",")})`,
    }
  }

  return {verdict: "PASS", evidence: "all 4 files present; dual-schema parity; api-token secret in both; no plaintext fixture-token; bundle caps respected"}
}

export function scoreRun(ctx: StageCtx): ScoreResult {
  // L18 stalled-agent path: when the handoff is COMPLETELY absent, S1..S10
  // are force-failed with the locked evidence (the agent never reached them —
  // the handoff is the funnel's ledger). A PARTIAL handoff is scored from
  // each stage's own evidence; genuinely-reached stages must not be forced
  // to fail by a single missing field.
  const stalled = handoffEmpty(ctx.handoff)
  const stageRows: StageRow[] = STAGES.map((s) => {
    const pass = stalled && s.stage !== "S0" && s.stage !== "S11" ? false : s.check(ctx)
    const attempts = ctx.transcript.stageAttempts[s.stage] ?? 0
    let evidence = s.evidence(ctx)
    if (stalled && !pass && s.stage !== "S0" && s.stage !== "S11") {
      evidence = "handoff incomplete - agent stalled"
    }
    return {
      stage: s.stage,
      gate: s.gate,
      pass,
      first_pass: pass && attempts === 1,
      attempts,
      evidence,
    }
  })

  const parity = computeParity(ctx)
  const parityTenant = computeParityTenant(ctx)
  const hygiene = computeHygiene(ctx)
  const s11 = stageRows.find((r) => r.stage === "S11")
  const handoffDiscipline = s11 ? s11.pass : false
  const firstPassCount = stageRows.filter((r) => r.first_pass).length
  const funnel = stageRows.filter((r) => r.pass).map((r) => r.stage)

  // The evidence strings are carried on the record so a FAIL verdict is
  // diagnosable from the JSONL alone. parity_evidence is ALWAYS the static
  // source-check evidence; the not_applicable tenant observation (zero by
  // construction — the draft test sync never persists) is a separate field.
  const parityTenantEvidence = parityTenant === "not_applicable"
    ? "draft test did not persist synced resources (tenant counts 0) — parity measured statically from source"
    : ""
  return {
    stageRows,
    parity_verdict: parity.verdict,
    parity_evidence: parity.evidence,
    parity_tenant: parityTenant,
    parity_tenant_evidence: parityTenantEvidence,
    hygiene_verdict: hygiene.verdict,
    hygiene_evidence: hygiene.evidence,
    handoff_discipline_verdict: handoffDiscipline,
    recovery_cycles: ctx.transcript.recoveryCycles,
    first_pass_rate: firstPassCount / STAGES.length,
    funnel,
  }
}

export {SKIPPED_STAGES}
