// squire.ts — thin squire-tool CLI client (CXF-216 PR 1).
// Drives the gateway exclusively through `squire-tool call <tool> '<json-args>'`
// via child_process (JSON in/out) — never hand-rolled MCP/HTTP.
import {execFile} from "node:child_process"
import {env} from "node:process"

export interface CallOpts {
  taskId?: string
}

// Per-call bound: a hung gateway call must not defeat the runner's bounded
// waits ("never a hung runner", locked L18).
const CALL_TIMEOUT_MS = 60_000

function runSquireTool(argv: string[]): Promise<{stdout: string; stderr: string}> {
  const {promise, resolve, reject} = Promise.withResolvers<{stdout: string; stderr: string}>()
  execFile("squire-tool", argv, {maxBuffer: 64 * 1024 * 1024, timeout: CALL_TIMEOUT_MS}, (err, stdout, stderr) => {
    if (err) {
      // Redact the args: they can carry the agent prompt, fixture credentials,
      // or stored api-token values — never cross the process boundary into
      // logs. Only the tool name + stderr are reported. NEVER fall back to
      // err.message: Node's execFile error embeds the FULL argv.
      const e = err as {killed?: boolean}
      const suffix = e.killed === true ? " (timed out after 60s)" : ""
      const detail = stderr.trim().length > 0 ? stderr.trim() : "(no stderr)"
      reject(new Error(`squire-tool call ${argv[1] ?? "?"} failed: ${detail}${suffix}`))
      return
    }
    resolve({stdout, stderr})
  })
  return promise
}

export async function call(
  tool: string,
  args: Record<string, unknown>,
  opts: CallOpts = {},
): Promise<unknown> {
  const argv = ["call", tool, JSON.stringify(args)]
  if (opts.taskId) argv.push("--task-id", opts.taskId)
  const {stdout} = await runSquireTool(argv)
const trimmed = stdout.trim()
  if (trimmed === "") return null
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    // Do NOT include the parse error message: JSON.parse errors embed a
    // snippet of the offending text, which could carry file content or
    // credentials (e.g. a non-JSON squire.fs.read response).
    throw new Error(`squire-tool call ${tool} returned non-JSON stdout`)
  }
}

export async function fsRead(path: string, opts: CallOpts = {}): Promise<unknown> {
  return call("squire.fs.read", {path}, opts)
}

export async function fsWrite(path: string, content: string, opts: CallOpts = {}): Promise<unknown> {
  return call("squire.fs.write", {path, content}, opts)
}

export async function getEnv(envId: string, opts: CallOpts = {}): Promise<Record<string, unknown>> {
  return call("get_env", {env_id: envId}, opts) as Promise<Record<string, unknown>>
}

export async function createEnv(
  args: Record<string, unknown>,
  opts: CallOpts = {},
): Promise<Record<string, unknown>> {
  return call("create_env", args, opts) as Promise<Record<string, unknown>>
}

export async function stopEnv(envId: string, opts: CallOpts = {}): Promise<unknown> {
  return call("stop_env", {env_id: envId}, opts)
}

export async function taskCreate(
  args: Record<string, unknown>,
  opts: CallOpts = {},
): Promise<Record<string, unknown>> {
  const res = await call("squire.task.create", args, opts)
  // A null/empty response must not become a TypeError at the call site.
  return (res ?? {}) as Record<string, unknown>
}

export async function getTask(
  envId: string,
  taskId: string,
  opts: CallOpts = {},
): Promise<Record<string, unknown>> {
  return call("get_task", {env_id: envId, task_id: taskId}, opts) as Promise<Record<string, unknown>>
}

export async function taskStream(
  envId: string,
  taskId: string,
  streamOpts: {sinceSeq?: number; limit?: number} = {},
  opts: CallOpts = {},
): Promise<Record<string, unknown>> {
  const args: Record<string, unknown> = {task_id: taskId}
  if (streamOpts.sinceSeq !== undefined) args.since_seq = streamOpts.sinceSeq
  if (streamOpts.limit !== undefined) args.limit = streamOpts.limit
  return call("squire.task.stream", args, opts) as Promise<Record<string, unknown>>
}

export async function listModels(opts: CallOpts = {}): Promise<Record<string, unknown>> {
  return call("list_models", {}, opts) as Promise<Record<string, unknown>>
}

export function resolveTaskId(explicit?: string): string | undefined {
  if (explicit) return explicit
  return env.SQUIRE_TASK_ID
}
