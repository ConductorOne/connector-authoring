// stream.ts — firehose parser + incremental poller (CXF-216 PR 1, L33).
// Event envelope (verified against a live task stream 2026-09-02):
//   {id, type, message, timestamp, data, seq}
//   tool_call:   name lives in `message` (e.g. "bash"); args in data.input
//                (an object, e.g. {i, command} for bash); data.call_id present
//   tool_result: name lives in data.tool_name; result text lives in the
//                top-level `message`; failure signal is data.is_error (bool)
import {taskStream, type CallOpts} from "./squire.ts"
import {isRecord} from "./scenario.ts"

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

// Stage attribution by tool-name suffix (L23 table). S11 covers both
// deploy_connector_instance and mint_approval_token — a compliant agent
// performs them back-to-back, so they count as ONE stage entry (attempts
// are stage-entry cycles, not raw tool calls; see parseStream).
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

// Failure signal: the real stream carries data.is_error (boolean); the
// data.error/data.isError candidates are defensive; the "error:"-prefixed
// message fallback is case-insensitive so "Error:" is not missed.
function toolError(data: Record<string, unknown>, message: string): unknown {
  const structured = firstValue(data.is_error, data.error, data.isError)
  if (structured !== undefined) return structured
  return message.toLowerCase().startsWith("error:") ? message : undefined
}

export function parseStream(events: unknown[]): ParsedStream {
  const toolCalls: ToolCallRecord[] = []
  // FIFO pairing: tool_result attaches to the OLDEST unmatched tool_call of
  // the same name (the stream emits results in call order; a LIFO reverse
  // scan mis-pairs repeated same-name calls such as get_run polls or PUTs).
  const pendingByName = new Map<string, number[]>()
  const errors: string[] = []
  const stageAttempts: Record<string, number> = {}
  const stageFailures: Record<string, number> = {}
  let turns = 0
  let lastWasText = false
  let tokensIn: number | null = null
  let tokensOut: number | null = null

  for (const raw of events) {
    if (!isRecord(raw)) continue
    const type = raw.type
    const data = isRecord(raw.data) ? raw.data : {}
    const message = typeof raw.message === "string" ? raw.message : ""

    if (type === "tool_call") {
      lastWasText = false
      const name = firstString(message, data.name, data.toolName) ?? "unknown"
      const args = firstValue(data.input, data.args)
      toolCalls.push({name, args})
      const queue = pendingByName.get(name) ?? []
      queue.push(toolCalls.length - 1)
      pendingByName.set(name, queue)
    } else if (type === "tool_result") {
      lastWasText = false
      const name = firstString(data.tool_name, data.name, data.toolName) ?? "unknown"
      const result = firstValue(message, data.result, data.output)
      const error = toolError(data, message)
      const queue = pendingByName.get(name)
      const idx = queue && queue.length > 0 ? queue.shift() : undefined
      if (idx !== undefined && toolCalls[idx]) {
        if (result !== undefined) toolCalls[idx].result = result
        if (error !== undefined) toolCalls[idx].error = error
      } else {
        // Orphan result (e.g. stream cap dropped the call): record it so a
        // failure is never silently lost.
        toolCalls.push({name, result: result ?? undefined, error: error ?? undefined})
      }
      if (error !== undefined && error !== null && error !== false) {
        errors.push(typeof error === "string" ? error : JSON.stringify(error))
      }
} else if (type === "text" || type === "text_delta") {
      // A burst of text_delta chunks is ONE assistant message — count
      // consecutive text events as a single turn (no inflation).
      if (!lastWasText) turns++
      lastWasText = true
    } else if (type === "user" || type === "user_message" || type === "human") {
      turns++
      lastWasText = false
    } else if (type === "usage") {
      const inTok = firstNumber(data.tokens_in, data.input_tokens, data.prompt_tokens)
      const outTok = firstNumber(data.tokens_out, data.output_tokens, data.completion_tokens)
      if (inTok !== null) tokensIn = (tokensIn ?? 0) + inTok
      if (outTok !== null) tokensOut = (tokensOut ?? 0) + outTok
      lastWasText = false
    } else {
      lastWasText = false
    }
    // unknown event shapes are skipped, never thrown
  }

// Stage attribution: attempts count STAGE-ENTRY CYCLES (consecutive calls
  // of the same stage — get_run polls, S11 deploy+mint — are one attempt),
  // so a clean run scores first_pass on every stage. A FAILURE of the stage
  // ends the current entry: the next call of that stage is a NEW attempt
  // (first_pass must be false for a stage that needed a retry). Recovery
  // cycles count a successful re-entry of a stage after a failure.
  let lastStage: string | null = null
  let lastFailedStage: string | null = null
  let recoveryCycles = 0
  for (const call of toolCalls) {
    const stage = stageForTool(call.name)
    if (stage === null) continue
    const failed = call.error !== undefined && call.error !== null && call.error !== false
    if (stage !== lastStage || lastFailedStage === stage) {
      stageAttempts[stage] = (stageAttempts[stage] ?? 0) + 1
      lastStage = stage
    }
    if (failed) {
      stageFailures[stage] = (stageFailures[stage] ?? 0) + 1
      lastFailedStage = stage
    } else if (lastFailedStage === stage) {
      recoveryCycles++
      lastFailedStage = null
    }
  }

  return {
    toolCalls,
    turns: Math.max(turns, 1),
    tokensIn,
    tokensOut,
    errors,
    stageAttempts,
    stageFailures,
    recoveryCycles,
  }
}

const sleep = (ms: number) => {
  const {promise, resolve} = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

// Poll squire.task.stream with a since_seq cursor every `intervalMs` during
// the agent run, accumulating pages so the ~1000-event cap cannot drop
// early-stage evidence (S0/S2). Keeps polling until `shouldStop()` returns
// true (the caller sets it when the agent task is terminal). The caller owns
// accumulation via `onEvents`; this returns only the last cursor for the
// final drain (no duplicate in-memory copy of the transcript).
export async function pollStreamIncrementally(
  envId: string,
  taskId: string,
  onEvents: (events: unknown[]) => void,
  intervalMs = 30_000,
  shouldStop: () => boolean = () => false,
  opts: CallOpts = {},
): Promise<{lastSeq: number}> {
  let sinceSeq = 0
  for (;;) {
    try {
      const page = (await taskStream(envId, taskId, {sinceSeq, limit: 500}, opts)) as Record<string, unknown>
      const events = (page.events ?? []) as unknown[]
      if (events.length > 0) {
        onEvents(events)
      }
      const nextSeq = page.next_seq as number | undefined
      if (nextSeq !== undefined && nextSeq > sinceSeq) sinceSeq = nextSeq
    } catch (err) {
      // Transient stream failures must not kill the poller (a gateway hiccup
      // mid-run would otherwise abort the whole eval).
      console.error(`WARNING: task.stream poll failed: ${(err as Error).message}`)
    }
    if (shouldStop()) break
    await sleep(intervalMs)
  }
  return {lastSeq: sinceSeq}
}
