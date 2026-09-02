/**
 * Normalizes a task firehose stream (squire.task.stream events) into a flat,
 * ordered tool-call log the deterministic scorer consumes.
 *
 * Harnesses (claude, codex, omp) emit differently-shaped events, so every
 * accessor here is alias-tolerant. Anything unrecognized is preserved in
 * `raw` for debugging but never gates a stage — the scorer only trusts
 * explicitly extracted fields.
 */

export interface TranscriptCall {
  seq: number;
  /** Normalized tool name with any MCP prefix stripped, e.g. c1_apps_create. */
  tool: string;
  /** Raw name as emitted, e.g. mcp__c1dev__c1_apps_create. */
  rawTool: string;
  args: Record<string, unknown>;
  argsText: string;
  ok: boolean;
  errorText: string | null;
  resultText: string;
  ts: string | null;
}

export interface NormalizedTranscript {
  calls: TranscriptCall[];
  /** Assistant text output, concatenated (used for markers + secret scans). */
  assistantText: string;
  turns: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

type Event = Record<string, unknown>;

const TOOL_CALL_TYPES = new Set(["tool_call", "tool_use", "function_call", "tool-invocation", "toolInvocation"]);
const TOOL_RESULT_TYPES = new Set(["tool_result", "tool-response", "toolResponse", "function_result"]);
const TEXT_TYPES = new Set(["text", "text_delta", "assistant", "message", "output_text"]);

const asString = (v: unknown): string | null => (typeof v === "string" ? v : null);

function eventType(e: Event): string {
  return asString(e.type) ?? asString(e.kind) ?? asString(e.event) ?? "";
}

function toolNameOf(e: Event): string {
  return asString(e.tool) ?? asString(e.tool_name) ?? asString(e.name) ?? asString(e.toolName) ?? "";
}

/** Strip harness MCP prefixes: mcp__c1dev__c1_apps_create -> c1_apps_create. */
export function normalizeToolName(raw: string): string {
  let name = raw;
  const mcp = name.match(/^mcp__[^_]+__(.+)$/);
  if (mcp) name = mcp[1];
  return name;
}

function argsOf(e: Event): { args: Record<string, unknown>; argsText: string } {
  const raw = e.args ?? e.input ?? e.arguments ?? e.params;
  if (raw == null) return { args: {}, argsText: "" };
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null
        ? { args: parsed as Record<string, unknown>, argsText: raw }
        : { args: {}, argsText: raw };
    } catch {
      return { args: {}, argsText: raw };
    }
  }
  if (typeof raw === "object") return { args: raw as Record<string, unknown>, argsText: JSON.stringify(raw) };
  return { args: {}, argsText: String(raw) };
}

function resultTextOf(e: Event): string {
  const raw = e.result ?? e.content ?? e.output ?? e.response;
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    // claude-style content blocks: [{type: "text", text: "..."}]
    return raw
      .map((b) => (typeof b === "string" ? b : asString((b as Event).text) ?? JSON.stringify(b)))
      .join("\n");
  }
  return JSON.stringify(raw);
}

function errorOf(e: Event): string | null {
  const err = e.error ?? e.errorText ?? (e.is_error === true ? resultTextOf(e) : null);
  if (err == null) return null;
  return typeof err === "string" ? err : JSON.stringify(err);
}

function tsOf(e: Event): string | null {
  return asString(e.ts) ?? asString(e.timestamp) ?? asString(e.created_at) ?? null;
}

/** call-id used to pair results with calls across harnesses. */
function callIdOf(e: Event): string | null {
  return asString(e.id) ?? asString(e.tool_call_id) ?? asString(e.toolUseId) ?? asString(e.call_id) ?? null;
}

function usageOf(e: Event): { tokensIn: number | null; tokensOut: number | null } {
  const usage = (e.usage ?? e.token_usage ?? {}) as Event;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    tokensIn: num(usage.input_tokens) ?? num(usage.tokens_in) ?? num(usage.prompt_tokens),
    tokensOut: num(usage.output_tokens) ?? num(usage.tokens_out) ?? num(usage.completion_tokens),
  };
}

export function normalizeTranscript(events: Event[]): NormalizedTranscript {
  const calls: TranscriptCall[] = [];
  const pendingById = new Map<string, number>();
  const textParts: string[] = [];
  let turns = 0;
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;

  for (const raw of events) {
    // Firehose events are {id, type, message, timestamp, data}; the harness
    // payload (tool name, args, result, usage) lives in `data`. Merge it over
    // the envelope so the alias accessors below see one flat view.
    const data = raw.data;
    const e: Event =
      typeof data === "object" && data !== null && !Array.isArray(data)
        ? { ...(data as Event), type: raw.type ?? (data as Event).type, id: raw.id ?? (data as Event).id, ts: raw.timestamp ?? (data as Event).ts }
        : raw;
    const type = eventType(e);
    if (TOOL_CALL_TYPES.has(type)) {
      const { args, argsText } = argsOf(e);
      const rawTool = toolNameOf(e);
      const call: TranscriptCall = {
        seq: calls.length,
        tool: normalizeToolName(rawTool),
        rawTool,
        args,
        argsText,
        ok: true, // provisional; a paired error result flips it
        errorText: null,
        resultText: "",
        ts: tsOf(e),
      };
      calls.push(call);
      const id = callIdOf(e);
      if (id) pendingById.set(id, call.seq);
      continue;
    }
    if (TOOL_RESULT_TYPES.has(type)) {
      const id = callIdOf(e);
      const idx = id !== null ? pendingById.get(id) : undefined;
      const target = idx !== undefined ? calls[idx] : calls[calls.length - 1];
      if (target && target.resultText === "") {
        target.resultText = resultTextOf(e);
        const err = errorOf(e);
        if (err !== null) {
          target.ok = false;
          target.errorText = err;
        }
      }
      continue;
    }
    if (TEXT_TYPES.has(type)) {
      const text = asString(e.text) ?? asString(e.delta) ?? asString(e.content) ?? asString(e.message);
      if (text) textParts.push(text);
      if (type === "message" || type === "assistant") turns++;
      continue;
    }
    if (type === "usage" || type === "turn_usage" || type === "result") {
      const u = usageOf(e);
      if (u.tokensIn !== null) tokensIn = (tokensIn ?? 0) + u.tokensIn;
      if (u.tokensOut !== null) tokensOut = (tokensOut ?? 0) + u.tokensOut;
    }
  }

  return {
    calls,
    assistantText: textParts.join(""),
    turns: turns > 0 ? turns : null,
    tokensIn,
    tokensOut,
  };
}

/**
 * Extract a JSON-ish field from tool result text. Handles both raw JSON
 * (`"catalogId": "x"`) and proto-style snake_case keys; returns the first
 * non-empty match across aliases.
 */
export function extractField(text: string, keys: string[]): string | null {
  for (const key of keys) {
    const re = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`);
    const m = text.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}
