// stream.ts — firehose parser + incremental poller (CXF-216 PR 1, L33).
// Event envelope: {id, type, message, timestamp, data} with a stable per-call
// `seq`. Field-name candidates are LOCKED (data.name/data.toolName,
// data.args/data.input, data.result/data.output, data.error/data.isError) plus
// OBSERVED additions from a real task stream (sanity-checked 2026-09-02):
//   tool_call:  name lives in `message` (e.g. "bash"); args in data.input
//   tool_result: name lives in data.tool_name; result text lives in `message`
import {taskStream, type CallOpts} from "./squire.ts"

export interface ToolCallRecord {
  name: string
  args?: unknown
  result?: unknown
  error?: unknown
}

export interface ParsedStream {
  toolCalls: ToolCallRecord[]
  turns: number
  tokensIn: number | null
  tokensOut: number | null
  errors: string[]
  stageAttempts: Record<string, number>
  stageFailures: Record<string, number>
  recoveryCycles: number
}

// Stage attribution by tool-name suffix (L23 table).
const STAGE_BY_SUFFIX: Record<string, string> = {
  get_authoring_guide: "S0",
  create_draft: "S1",
  create_draft_source_upload: "S2",
  get_draft: "S3",
  build_bundle: "S4",
  get_run: "S5",
  c1_apps_create: "S6",
  provision_connector: "S7",
  c1_connector_service_update: "S8",
  run_draft_test_sync: "S9",
  get_test_run_evidence: "S10",
  deploy_connector_instance: "S11",
  mint_approval_token: "S11",
}

export function stageForTool(name: string): string | null {
  for (const [suffix, stage] of Object.entries(STAGE_BY_SUFFIX)) {
    if (name.endsWith(suffix)) return stage
  }
  return null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function firstString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c
  }
  return null
}

function firstValue(...candidates: unknown[]): unknown {
  for (const c of candidates) {
    if (c !== undefined && c !== null) return c
  }
  return undefined
}

function firstNumber(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c
  }
  return null
}

export function parseStream(events: unknown[]): ParsedStream {
  const toolCalls: ToolCallRecord[] = []
  const errors: string[] = []
  const stageAttempts: Record<string, number> = {}
  const stageFailures: Record<string, number> = {}
  let turns = 0
  let tokensIn: number | null = null
  let tokensOut: number | null = null
  let lastFailedStage: string | null = null
  let recoveryCycles = 0

  for (const raw of events) {
    if (!isRecord(raw)) continue
    const type = raw.type
    const data = isRecord(raw.data) ? raw.data : {}
    const message = typeof raw.message === "string" ? raw.message : ""

    if (type === "tool_call") {
      const name = firstString(message, data.name, data.toolName) ?? "unknown"
      const args = firstValue(data.input, data.args)
      toolCalls.push({name, args})
      const stage = stageForTool(name)
      if (stage) {
        stageAttempts[stage] = (stageAttempts[stage] ?? 0) + 1
        if (lastFailedStage === stage) recoveryCycles++
        lastFailedStage = null
      }
} else if (type === "tool_result") {
      const name = firstString(data.tool_name, data.name, data.toolName) ?? "unknown"
      const result = firstValue(message, data.result, data.output)
      // Observed failure signal: the harness prefixes failed-command results
      // with "error: " (no data.error/isError field exists in this stream).
      const error = firstValue(data.error, data.isError) ?? (message.startsWith("error:") ? message : undefined)
      const call = [...toolCalls].reverse().find((c) => c.name === name)
      if (call) {
        if (result !== undefined) call.result = result
        if (error !== undefined) call.error = error
      }
      if (error !== undefined && error !== null && error !== false) {
        errors.push(typeof error === "string" ? error : JSON.stringify(error))
        const stage = stageForTool(name)
        if (stage) {
          stageFailures[stage] = (stageFailures[stage] ?? 0) + 1
          lastFailedStage = stage
        }
      }
    } else if (type === "user" || type === "user_message" || type === "human") {
      turns++
    } else if (type === "usage") {
      const inTok = firstNumber(data.tokens_in, data.input_tokens, data.prompt_tokens)
      const outTok = firstNumber(data.tokens_out, data.output_tokens, data.completion_tokens)
      if (inTok !== null) tokensIn = (tokensIn ?? 0) + inTok
      if (outTok !== null) tokensOut = (tokensOut ?? 0) + outTok
    }
    // unknown event shapes are skipped, never thrown
  }

  return {
    toolCalls,
    turns: Math.max(turns + 1, 1),
    tokensIn,
    tokensOut,
    errors,
    stageAttempts,
    stageFailures,
    recoveryCycles,
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Poll squire.task.stream with a since_seq cursor every `intervalMs` during
// the agent run, accumulating pages so the ~1000-event cap cannot drop
// early-stage evidence (S0/S2). Keeps polling until `shouldStop()` returns
// true (the caller sets it when the agent task is terminal); returns the
// accumulated events plus the last cursor for a final drain.
export async function pollStreamIncrementally(
  envId: string,
  taskId: string,
  onEvents: (events: unknown[]) => void,
  intervalMs = 30_000,
  shouldStop: () => boolean = () => false,
  opts: CallOpts = {},
): Promise<{events: unknown[]; lastSeq: number}> {
  const all: unknown[] = []
  let sinceSeq = 0
  for (;;) {
    const page = (await taskStream(envId, taskId, {sinceSeq, limit: 500}, opts)) as Record<string, unknown>
    const events = (page.events ?? []) as unknown[]
    if (events.length > 0) {
      all.push(...events)
      onEvents(events)
    }
    const nextSeq = page.next_seq as number | undefined
    if (nextSeq !== undefined && nextSeq > sinceSeq) sinceSeq = nextSeq
    if (shouldStop()) break
    await sleep(intervalMs)
  }
  return {events: all, lastSeq: sinceSeq}
}
